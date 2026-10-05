import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import type { IdentityVerifier } from '../lib/firebase.js';
import type { PrismaClient } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { resolvePrincipal, type Principal } from '../modules/auth/principal.js';
import { canSeeCanteen } from '../modules/canteens/canteens.service.js';
import { rooms, type EventPublisher, type RealtimeEvent, type RoomCommand } from './events.js';

interface SocketData {
  uid: string;
  principal: Principal;
}

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
 * Handshake: `io(url, { auth: { token: <Firebase ID token> } })`. The token is
 * verified with Firebase (revocation checked) and the principal is loaded from
 * PostgreSQL — exactly like REST. Rooms are assigned by the server; the only
 * client-initiated membership is the read-only public menu room of a canteen
 * the caller is allowed to see.
 */
export function createRealtimeServer(
  httpServer: HttpServer,
  deps: { env: Env; logger: Logger; prisma: PrismaClient; verifier: IdentityVerifier },
) {
  const { env, logger, prisma, verifier } = deps;
  const io = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGINS, credentials: false },
    serveClient: false,
    maxHttpBufferSize: 10_000,
    connectionStateRecovery: undefined,
  });

  /** Returns an Error to reject the handshake, or null to accept it. */
  async function authenticateSocket(socket: Socket): Promise<Error | null> {
    try {
      const token: unknown = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
      if (typeof token !== 'string' || token.length === 0) {
        return connectError('AUTH_REQUIRED', 'Authentication required');
      }
      const identity = await verifier.verifyIdToken(token);
      const principal = await resolvePrincipal(prisma, identity.uid);
      if (!principal) {
        return connectError('ACCOUNT_NOT_REGISTERED', 'Complete your SERVE registration first.');
      }
      if (!principal.isActive) return connectError('ACCOUNT_DISABLED', 'This account is disabled.');
      socket.data = { uid: identity.uid, principal } satisfies SocketData;
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
    const { principal, uid } = dataOf(socket);
    void socket.join(roomsFor(principal));

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
        const current = (await resolvePrincipal(prisma, uid)) ?? principal;
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
        io.to(event.rooms).emit(event.name, event.payload);
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
