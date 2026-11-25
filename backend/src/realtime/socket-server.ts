import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import type { SessionVerifier } from '../lib/session.js';
import type { PrismaClient } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { resolvePrincipal, type Principal } from '../modules/auth/principal.js';
import type { AuthMethod } from '../modules/auth/sign-in-method.js';
import { principalForSession } from '../middleware/auth.js';
import { canSeeCanteen } from '../modules/canteens/canteens.service.js';
import {
  rooms,
  type EventPublisher,
  type RealtimeEnvelope,
  type RealtimeEvent,
  type RoomCommand,
} from './events.js';

interface SocketData {
  uid: string;
  email: string;
  principal: Principal;
  sessionId: string;
  authMethod: AuthMethod | null;
  tokenExpiresAt: number;
}

/** Longest timer Node supports (~24.8 days); sessions last 7 days. */
const MAX_TIMER_MS = 2_147_483_647;
/** How often an open socket re-checks that its session still exists (sign-out, revocation). */
export const SESSION_RECHECK_MS = 60_000;

const dataOf = (socket: Socket) => socket.data as SocketData;

type Ack = (
  response:
    { ok: true; canteenId: string } | { ok: false; error: { code: string; message: string } },
) => void;

const subscribeSchema = z.object({ canteenId: z.uuid() });

/** Server-assigned rooms for an authenticated principal. Clients never choose these. */
export function roomsFor(principal: Principal): string[] {
  switch (principal.role) {
    case 'STUDENT':
      return [rooms.student(principal.id)];
    case 'STAFF':
      return principal.status === 'APPROVED' && principal.canteenId
        ? [rooms.staff(principal.id), rooms.canteen(principal.canteenId)]
        : [rooms.staff(principal.id)];
    case 'ADMIN':
      return [rooms.adminUser(principal.id), rooms.admins()];
  }
}

function connectError(code: string, message: string): Error {
  const err = new Error(message) as Error & { data: { code: string } };
  err.data = { code };
  return err;
}

/**
 * Authenticated Socket.IO server.
 *
 * Handshake: the web apps send Better Auth's session cookie (withCredentials);
 * the native app sends `io(url, { auth: { token: <session token> } })`. The
 * session is verified by Better Auth, the principal is loaded from
 * PostgreSQL and the session's sign-in method must match the role, exactly
 * like REST (students: Google; staff and admins: email + password). Rooms are assigned by the server; the only
 * client-initiated membership is the read-only public menu room of a canteen
 * the caller is allowed to see.
 */
export function createRealtimeServer(
  httpServer: HttpServer,
  deps: {
    env: Env;
    logger: Logger;
    prisma: PrismaClient;
    sessions: SessionVerifier;
    /** How often open sockets re-check their session (tests use a short interval). */
    sessionRecheckMs?: number;
  },
) {
  const { env, logger, prisma, sessions } = deps;
  const recheckMs = deps.sessionRecheckMs ?? SESSION_RECHECK_MS;
  const io = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    serveClient: false,
    maxHttpBufferSize: 10_000,
    connectionStateRecovery: undefined,
  });

  /** Returns an Error to reject the handshake, or null to accept it. */
  async function authenticateSocket(socket: Socket): Promise<Error | null> {
    try {
      const token: unknown = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
      const headers = new Headers();
      const cookie = socket.request.headers.cookie;
      if (typeof token === 'string' && token.length > 0) {
        headers.set('authorization', `Bearer ${token}`);
      } else if (cookie) {
        headers.set('cookie', cookie);
      }
      const identity = await sessions.verify(headers);
      if (!identity) return connectError('AUTH_REQUIRED', 'Authentication required');
      // Refuses (and revokes) a session whose sign-in method the role does not allow.
      const principal = await principalForSession(prisma, identity);
      if (!principal) {
        return connectError('ACCOUNT_NOT_REGISTERED', 'Complete your SERVE registration first.');
      }
      if (!principal.isActive) return connectError('ACCOUNT_DISABLED', 'This account is disabled.');
      socket.data = {
        uid: identity.uid,
        email: identity.email,
        principal,
        sessionId: identity.sessionId,
        authMethod: identity.authMethod,
        tokenExpiresAt: identity.expiresAt.getTime(),
      } satisfies SocketData;
      return null;
    } catch (err) {
      if (err instanceof AppError) return connectError(err.code, err.message);
      logger.error({ err }, 'Socket authentication failed');
      return connectError('AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable.');
    }
  }

  io.use((socket, next) => {
    void authenticateSocket(socket).then((rejection) => next(rejection ?? undefined));
  });

  io.on('connection', (socket) => {
    const { principal, uid, email, sessionId, authMethod, tokenExpiresAt } = dataOf(socket);
    void socket.join(roomsFor(principal));

    // A socket never outlives the session it was opened with: at expiry, or
    // within SESSION_RECHECK_MS of sign-out/revocation, the client is told
    // why and disconnected; it reconnects and is re-verified from scratch.
    const end = () => {
      socket.emit('auth.expired', {
        type: 'auth.expired',
        occurredAt: new Date().toISOString(),
        data: { reason: 'TOKEN_EXPIRED' },
      });
      socket.disconnect(true);
    };
    const expiryTimer = setTimeout(
      end,
      Math.min(Math.max(tokenExpiresAt - Date.now(), 0), MAX_TIMER_MS),
    );
    const recheck = setInterval(() => {
      void prisma.authSession
        .findUnique({ where: { id: sessionId }, select: { expiresAt: true } })
        .then((row) => {
          if (!row || row.expiresAt.getTime() <= Date.now()) end();
        })
        .catch((err: unknown) => logger.warn({ err }, 'Socket session re-check failed'));
    }, recheckMs);
    recheck.unref();
    socket.on('disconnect', () => {
      clearTimeout(expiryTimer);
      clearInterval(recheck);
    });

    // Public menu/status updates for one canteen at a time (server-validated).
    socket.on('menu:subscribe', async (payload: unknown, ack?: Ack) => {
      const reply: Ack = typeof ack === 'function' ? ack : () => undefined;
      const parsed = subscribeSchema.safeParse(payload);
      if (!parsed.success) {
        reply({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'A valid canteenId is required.' },
        });
        return;
      }
      try {
        // Re-read the principal so permissions reflect the latest database state.
        const current = (await resolvePrincipal(prisma, { uid, email, authMethod })) ?? principal;
        const canteen = await prisma.canteen.findUnique({
          where: { id: parsed.data.canteenId },
          select: { id: true, isActive: true },
        });
        if (!canteen || !canSeeCanteen(current, canteen)) {
          reply({ ok: false, error: { code: 'CANTEEN_NOT_FOUND', message: 'Canteen not found.' } });
          return;
        }
        for (const room of socket.rooms) {
          if (room.startsWith('canteen-public:')) void socket.leave(room);
        }
        void socket.join(rooms.canteenPublic(canteen.id));
        reply({ ok: true, canteenId: canteen.id });
      } catch (err) {
        logger.error({ err }, 'menu:subscribe failed');
        reply({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } });
      }
    });

    socket.on('menu:unsubscribe', () => {
      for (const room of socket.rooms) {
        if (room.startsWith('canteen-public:')) void socket.leave(room);
      }
    });
  });

  const publisher: EventPublisher = {
    publish(events: RealtimeEvent[]) {
      for (const event of events) {
        if (event.rooms.length === 0) continue;
        const envelope: RealtimeEnvelope = {
          type: event.name,
          occurredAt: new Date().toISOString(),
          data: event.payload,
        };
        io.to(event.rooms).emit(event.name, envelope);
      }
    },
    apply(commands: RoomCommand[]) {
      for (const command of commands) {
        const staffRoom = rooms.staff(command.staffId);
        if (command.type === 'disconnect-staff') {
          io.in(staffRoom).disconnectSockets(true);
          continue;
        }
        // Move the staff member's live sockets to their new canteen room.
        void io
          .in(staffRoom)
          .fetchSockets()
          .then((sockets) => {
            for (const socket of sockets) {
              for (const room of socket.rooms) {
                if (room.startsWith('canteen:')) socket.leave(room);
              }
              if (command.canteenId) socket.join(rooms.canteen(command.canteenId));
            }
          })
          .catch((err: unknown) => logger.error({ err }, 'Failed to move staff sockets'));
      }
    },
  };

  return {
    io,
    publisher,
    close: () => new Promise<void>((resolve) => void io.close(() => resolve())),
  };
}

/**
 * Lets the Express app be created before the Socket.IO server exists
 * (Socket.IO must attach to the HTTP server after Express' request handler).
 */
export class RealtimeBridge implements EventPublisher {
  private target: EventPublisher | null = null;

  attach(target: EventPublisher): void {
    this.target = target;
  }

  publish(events: RealtimeEvent[]): void {
    this.target?.publish(events);
  }

  apply(commands: RoomCommand[]): void {
    this.target?.apply(commands);
  }
}
