import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeProvider, useRealtime, useServerEvent } from '../src/realtime';

type Handler = (...args: unknown[]) => void;
const sockets: FakeIoSocket[] = [];

class FakeIoSocket {
  handlers = new Map<string, Handler[]>();
  emit = vi.fn();
  connect = vi.fn();
  disconnect = vi.fn();
  constructor(
    readonly url: string,
    readonly options: {
      transports: string[];
      auth: (cb: (data: { token: string }) => void) => void;
    },
  ) {}
  on(name: string, fn: Handler) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
    return this;
  }
  off(name: string, fn: Handler) {
    this.handlers.set(
      name,
      (this.handlers.get(name) ?? []).filter((h) => h !== fn),
    );
    return this;
  }
  removeAllListeners() {
    this.handlers.clear();
    return this;
  }
  fire(name: string, ...args: unknown[]) {
    for (const fn of this.handlers.get(name) ?? []) fn(...args);
  }
  handshake() {
    return new Promise<{ token: string }>((resolve) => this.options.auth(resolve));
  }
}

vi.mock('socket.io-client', () => ({
  io: (url: string, options: FakeIoSocket['options']) => {
    const socket = new FakeIoSocket(url, options);
    sockets.push(socket);
    return socket;
  },
}));

function Probe() {
  const { state, connectionEpoch } = useRealtime();
  useServerEvent('order.ready', (data) => {
    document.title = data.order.orderNumber;
  });
  return (
    <p>
      {state}:{connectionEpoch}
    </p>
  );
}

beforeEach(() => {
  sockets.length = 0;
  document.title = '';
});

describe('RealtimeProvider', () => {
  it('connects over websocket and sends the current Firebase token in the handshake', async () => {
    const getToken = vi.fn(async (force?: boolean) => (force ? 'fresh' : 'cached'));
    render(
      <RealtimeProvider url="http://localhost:5001" getToken={getToken} enabled>
        <Probe />
      </RealtimeProvider>,
    );
    const socket = sockets[0]!;
    expect(socket.url).toBe('http://localhost:5001');
    expect(socket.options.transports).toEqual(['websocket']);
    await expect(socket.handshake()).resolves.toEqual({ token: 'cached' });
    expect(getToken).toHaveBeenCalledWith(false);
  });

  it('never names rooms: the client emits nothing on connect', () => {
    render(
      <RealtimeProvider url="http://localhost:5001" getToken={async () => 't'} enabled>
        <Probe />
      </RealtimeProvider>,
    );
    act(() => sockets[0]!.fire('connect'));
    expect(sockets[0]!.emit).not.toHaveBeenCalled();
  });

  it('bumps the connection epoch on every (re)connect so screens refetch', () => {
    render(
      <RealtimeProvider url="http://localhost:5001" getToken={async () => 't'} enabled>
        <Probe />
      </RealtimeProvider>,
    );
    const socket = sockets[0]!;
    expect(screen.getByText('connecting:0')).toBeInTheDocument();
    act(() => socket.fire('connect'));
    expect(screen.getByText('connected:1')).toBeInTheDocument();
    act(() => socket.fire('disconnect', 'transport close'));
    expect(screen.getByText('disconnected:1')).toBeInTheDocument();
    act(() => socket.fire('connect'));
    expect(screen.getByText('connected:2')).toBeInTheDocument();
  });

  it('reconnects with a force-refreshed token after auth.expired', async () => {
    const getToken = vi.fn(async (force?: boolean) => (force ? 'fresh' : 'cached'));
    render(
      <RealtimeProvider url="http://localhost:5001" getToken={getToken} enabled>
        <Probe />
      </RealtimeProvider>,
    );
    const socket = sockets[0]!;
    act(() => {
      socket.fire('auth.expired', {
        type: 'auth.expired',
        occurredAt: '',
        data: { reason: 'TOKEN_EXPIRED' },
      });
      socket.fire('disconnect', 'io server disconnect');
    });
    expect(socket.connect).toHaveBeenCalledOnce();
    await expect(socket.handshake()).resolves.toEqual({ token: 'fresh' });
    // Only the first handshake after expiry forces a refresh.
    await expect(socket.handshake()).resolves.toEqual({ token: 'cached' });
  });

  it('does not reconnect after a server disconnect that was not a token expiry', () => {
    render(
      <RealtimeProvider url="http://localhost:5001" getToken={async () => 't'} enabled>
        <Probe />
      </RealtimeProvider>,
    );
    act(() => sockets[0]!.fire('disconnect', 'io server disconnect'));
    expect(sockets[0]!.connect).not.toHaveBeenCalled();
  });

  it('delivers the envelope data to subscribers', () => {
    render(
      <RealtimeProvider url="http://localhost:5001" getToken={async () => 't'} enabled>
        <Probe />
      </RealtimeProvider>,
    );
    act(() =>
      sockets[0]!.fire('order.ready', {
        type: 'order.ready',
        occurredAt: '',
        data: { order: { orderNumber: 'SV1042' }, previousStatus: 'PREPARING' },
      }),
    );
    expect(document.title).toBe('SV1042');
  });

  it('opens no socket while disabled (signed out, unregistered or deactivated)', () => {
    render(
      <RealtimeProvider url="http://localhost:5001" getToken={async () => 't'} enabled={false}>
        <Probe />
      </RealtimeProvider>,
    );
    expect(sockets).toHaveLength(0);
  });
});
