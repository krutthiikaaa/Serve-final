import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connectClient, type Socket } from 'socket.io-client';
import { createApp } from '../../src/app.js';
import { createRealtimeServer, RealtimeBridge } from '../../src/realtime/socket-server.js';
import { buildTestContext } from './test-app.js';

/**
 * Starts the REAL backend (Express + Socket.IO) on an ephemeral port, wired to
 * the test database and the Firebase Auth Emulator — the same composition as
 * src/server.ts.
 */
export async function startTestServer() {
  const bridge = new RealtimeBridge();
  const ctx = buildTestContext({ events: bridge });
  const app = createApp(ctx);
  const server: Server = createServer(app);
  const realtime = createRealtimeServer(server, ctx);
  bridge.attach(realtime.publisher);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sockets: Socket[] = [];

  return {
    app,
    ctx,
    url,
    prisma: ctx.prisma,
    /** Connect an authenticated client; resolves once connected. */
    async connect(token: string | null): Promise<Socket> {
      const socket = connectClient(url, {
        auth: token === null ? {} : { token },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', (err) => reject(err));
      });
      return socket;
    },
    /** Attempt a connection that should be rejected; resolves with the error code. */
    async rejectedConnect(token: string | null): Promise<string | undefined> {
      const socket = connectClient(url, {
        auth: token === null ? {} : { token },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      sockets.push(socket);
      return new Promise((resolve, reject) => {
        socket.once('connect', () => reject(new Error('connection unexpectedly succeeded')));
        socket.once('connect_error', (err: Error & { data?: { code?: string } }) =>
          resolve(err.data?.code),
        );
      });
    },
    async close() {
      for (const socket of sockets) socket.disconnect();
      await realtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await ctx.prisma.$disconnect();
    },
  };
}

export type TestServer = Awaited<ReturnType<typeof startTestServer>>;

/**
 * Wait for the next matching event on a socket. Every server event uses the
 * envelope { type, occurredAt, data }; this checks the envelope and resolves
 * with `data`.
 */
export function nextEvent<T = Record<string, unknown>>(
  socket: Socket,
  name: string,
  predicate: (data: T) => boolean = () => true,
  timeoutMs = 5_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, handler);
      reject(new Error(`Timed out waiting for "${name}"`));
    }, timeoutMs);
    const handler = (envelope: { type: string; occurredAt: string; data: T }) => {
      if (envelope.type !== name || Number.isNaN(Date.parse(envelope.occurredAt))) {
        clearTimeout(timer);
        socket.off(name, handler);
        reject(new Error(`Malformed envelope for "${name}": ${JSON.stringify(envelope)}`));
        return;
      }
      if (!predicate(envelope.data)) return;
      clearTimeout(timer);
      socket.off(name, handler);
      resolve(envelope.data);
    };
    socket.on(name, handler);
  });
}

/** Records every event a socket receives (for "must NOT receive" assertions). */
export function recordEvents(socket: Socket) {
  const received: { name: string; data: Record<string, unknown> }[] = [];
  socket.onAny((name: string, envelope: { data: Record<string, unknown> }) =>
    received.push({ name, data: envelope.data }),
  );
  return received;
}

export const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

export function subscribeMenu(socket: Socket, canteenId: unknown) {
  return socket.timeout(5_000).emitWithAck('menu:subscribe', { canteenId }) as Promise<{
    ok: boolean;
    canteenId?: string;
    error?: { code: string };
  }>;
}
