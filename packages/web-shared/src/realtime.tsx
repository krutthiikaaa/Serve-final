import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { RealtimeEnvelope, ServerEventName, ServerEvents } from '@serve/contracts';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface RealtimeContextValue {
  socket: Socket | null;
  state: ConnectionState;
  /** Increments on every successful (re)connection — use it to refetch REST data. */
  connectionEpoch: number;
}

/** Exported for tests, which provide a fake socket. Apps use RealtimeProvider. */
export const RealtimeContext = createContext<RealtimeContextValue>({
  socket: null,
  state: 'disconnected',
  connectionEpoch: 0,
});

/**
 * One authenticated Socket.IO connection per signed-in session.
 * - The token is supplied through the `auth` callback, so every (re)connect
 *   sends a fresh Firebase ID token.
 * - The client never names rooms: the server assigns them from PostgreSQL.
 * - On `auth.expired` the server disconnects; we force-refresh and reconnect.
 */
export function RealtimeProvider({
  url,
  getToken,
  enabled,
  children,
}: {
  url: string;
  getToken: (forceRefresh?: boolean) => Promise<string | null>;
  enabled: boolean;
  children: ReactNode;
}) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [state, setState] = useState<ConnectionState>('disconnected');
  const [connectionEpoch, setEpoch] = useState(0);
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;

  useEffect(() => {
    if (!enabled) return undefined;
    let forceRefresh = false;
    const s = io(url, {
      transports: ['websocket'],
      auth: (cb) => {
        void tokenRef.current(forceRefresh).then((token) => {
          forceRefresh = false;
          cb({ token: token ?? '' });
        });
      },
    });
    setState('connecting');
    s.on('connect', () => {
      setState('connected');
      setEpoch((n) => n + 1);
    });
    s.on('disconnect', (reason) => {
      setState('disconnected');
      // Server-initiated disconnects (token expiry) are not retried automatically.
      if (reason === 'io server disconnect' && forceRefresh) s.connect();
    });
    s.on('connect_error', () => setState('disconnected'));
    s.on('auth.expired', () => {
      forceRefresh = true;
    });
    setSocket(s);
    return () => {
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
      setState('disconnected');
    };
  }, [enabled, url]);

  return (
    <RealtimeContext.Provider value={{ socket, state, connectionEpoch }}>
      {children}
    </RealtimeContext.Provider>
  );
}

/** Server events are app-defined names; socket.io's reserved-event typing does not apply to them. */
type AnyListener = (...args: unknown[]) => void;
const asListener = <T,>(fn: (envelope: T) => void) => fn as unknown as AnyListener;

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}

/** Subscribe to one server event; the handler receives the envelope's `data`. */
export function useServerEvent<K extends ServerEventName>(
  name: K,
  handler: (data: ServerEvents[K], envelope: RealtimeEnvelope<ServerEvents[K]>) => void,
): void {
  const { socket } = useRealtime();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!socket) return undefined;
    const listener = asListener((envelope: RealtimeEnvelope<ServerEvents[K]>) =>
      handlerRef.current(envelope.data, envelope),
    );
    socket.on(name as string, listener);
    return () => {
      socket.off(name as string, listener);
    };
  }, [socket, name]);
}

/** Subscribe to several events with one handler (e.g. every order lifecycle event). */
export function useServerEvents<K extends ServerEventName>(
  names: readonly K[],
  handler: (name: K, data: ServerEvents[K]) => void,
): void {
  const { socket } = useRealtime();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const key = names.join('|');
  useEffect(() => {
    if (!socket) return undefined;
    const listeners = names.map((name) => {
      const listener = asListener((envelope: RealtimeEnvelope<ServerEvents[K]>) =>
        handlerRef.current(name, envelope.data),
      );
      socket.on(name as string, listener);
      return [name, listener] as const;
    });
    return () => {
      for (const [name, listener] of listeners) socket.off(name as string, listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, key]);
}
