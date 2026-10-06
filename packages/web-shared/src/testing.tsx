import { useMemo, type ReactNode } from 'react';
import type { Me } from '@serve/contracts';
import { ApiClient } from './api';
import { AuthContext, type AuthContextValue } from './auth';
import type { Socket } from 'socket.io-client';
import type { RealtimeEnvelope, ServerEventName, ServerEvents } from '@serve/contracts';
import { RealtimeContext, type ConnectionState } from './realtime';

/**
 * Test helpers (imported from `@serve/web-shared/testing`, never from app code).
 * A minimal in-memory socket so components can be driven with server events.
 */
export interface FakeSocket {
  socket: Socket;
  /** Deliver a server event wrapped in the standard envelope. */
  serverEmit<K extends ServerEventName>(name: K, data: ServerEvents[K]): void;
  listenerCount(name: string): number;
  emitted: unknown[][];
}

export function createFakeSocket(): FakeSocket {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const emitted: unknown[][] = [];
  const socket = {
    on(name: string, fn: (...args: unknown[]) => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(fn);
      return socket;
    },
    off(name: string, fn: (...args: unknown[]) => void) {
      listeners.get(name)?.delete(fn);
      return socket;
    },
    emit(...args: unknown[]) {
      emitted.push(args);
      return socket;
    },
  };
  return {
    socket: socket as unknown as Socket,
    emitted,
    listenerCount: (name) => listeners.get(name)?.size ?? 0,
    serverEmit(name, data) {
      const envelope: RealtimeEnvelope<typeof data> = {
        type: name,
        occurredAt: new Date().toISOString(),
        data,
      };
      for (const fn of [...(listeners.get(name) ?? [])]) fn(envelope);
    },
  };
}

export function FakeRealtimeProvider({
  fake,
  state = 'connected',
  connectionEpoch = 1,
  children,
}: {
  fake: FakeSocket;
  state?: ConnectionState;
  connectionEpoch?: number;
  children: ReactNode;
}) {
  return (
    <RealtimeContext.Provider value={{ socket: fake.socket, state, connectionEpoch }}>
      {children}
    </RealtimeContext.Provider>
  );
}

/** Provides a signed-in auth context with a given backend account. */
export function FakeAuthProvider({
  me,
  overrides,
  children,
}: {
  me: Me | null;
  overrides?: Partial<AuthContextValue>;
  children: ReactNode;
}) {
  const value = useMemo<AuthContextValue>(
    () => ({
      status: me ? 'ready' : 'signedOut',
      user: null,
      me,
      error: null,
      api: new ApiClient({
        baseUrl: 'http://localhost:5001',
        getToken: async () => 'test-token',
        fetchImpl: async () => new Response('{}', { status: 599 }),
      }),
      getToken: async () => 'test-token',
      refreshMe: async () => me,
      signIn: async () => undefined,
      signUp: async () => undefined,
      signOut: async () => undefined,
      ...overrides,
    }),
    [me, overrides],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
