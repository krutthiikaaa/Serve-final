import { StrictMode, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Me } from '@serve/contracts';
import { ApiClient, ToastProvider } from '@serve/web-shared';
import { FakeAuthProvider } from '@serve/web-shared/testing';
import { Gate } from '../src/App';
import { meStaff } from './fixtures';

vi.mock('socket.io-client', () => ({
  io: () => ({ on() {}, off() {}, removeAllListeners() {}, disconnect() {}, connect() {} }),
}));

function renderCallback({
  path,
  meAfter,
  fetchImpl,
  signInWithCustomToken,
  waitForAuthReady,
  strict = false,
}: {
  path: string;
  meAfter?: Me | null;
  fetchImpl?: typeof fetch;
  signInWithCustomToken?: (token: string) => Promise<void>;
  waitForAuthReady?: () => Promise<void>;
  strict?: boolean;
}) {
  function Harness() {
    const [me, setMe] = useState<Me | null>(null);
    return (
      <ToastProvider>
        <FakeAuthProvider
          me={me}
          overrides={{
            api: new ApiClient({
              baseUrl: 'http://localhost:5001',
              getToken: async () => 'should-not-be-sent',
              fetchImpl:
                fetchImpl ??
                (async () => new Response('{}', { status: 599, headers: { 'Content-Type': 'application/json' } })),
            }),
            signInWithCustomToken: async (token: string) => {
              if (signInWithCustomToken) await signInWithCustomToken(token);
              if (meAfter) setMe(meAfter);
            },
            ...(waitForAuthReady ? { waitForAuthReady } : {}),
          }}
        >
          <MemoryRouter initialEntries={[path]}>
            <Gate />
          </MemoryRouter>
        </FakeAuthProvider>
      </ToastProvider>
    );
  }
  return render(
    strict ? (
      <StrictMode>
        <Harness />
      </StrictMode>
    ) : (
      <Harness />
    ),
  );
}

describe('staff SSO callback', () => {
  it('exchanges the code, signs in with a Custom Token, and opens the dashboard', async () => {
    const signInWithCustomToken = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:5001/api/auth/sso/exchange');
      expect(init?.method).toBe('POST');
      expect(init?.headers).not.toHaveProperty('Authorization');
      expect(JSON.parse(String(init?.body))).toEqual({
        code: 'handoff-code-value32charsxx',
        audience: 'STAFF',
      });
      return new Response(JSON.stringify({ data: { customToken: 'firebase-custom-token' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    renderCallback({
      path: '/sso/callback?code=handoff-code-value32charsxx',
      meAfter: meStaff(),
      fetchImpl,
      signInWithCustomToken,
    });
    expect(screen.getByText('Completing sign-in')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    await waitFor(() => expect(signInWithCustomToken).toHaveBeenCalledWith('firebase-custom-token'));
    expect(
      fetchImpl.mock.calls.filter((call) => String(call[0]).includes('/auth/sso/exchange')),
    ).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: 'Staff dashboard navigation' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.getAllByText('Krishna & Godavari Night Canteen').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(screen.queryByText('Completing sign-in')).not.toBeInTheDocument();
  });

  it('waits for Firebase Auth persistence before exchanging the code', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waitForAuthReady = vi.fn(() => blocked);
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { customToken: 'after-auth-ready-token' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const signInWithCustomToken = vi.fn(async () => undefined);
    renderCallback({
      path: '/sso/callback?code=wait-auth-ready-code32xx',
      meAfter: meStaff(),
      fetchImpl,
      signInWithCustomToken,
      waitForAuthReady,
    });
    await waitFor(() => expect(waitForAuthReady).toHaveBeenCalled());
    expect(fetchImpl).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(signInWithCustomToken).toHaveBeenCalledWith('after-auth-ready-token'));
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('exchanges a one-time code only once under React Strict Mode', async () => {
    const signInWithCustomToken = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/auth/sso/exchange')) {
        return new Response(JSON.stringify({ data: { customToken: 'strict-custom-token' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 599, headers: { 'Content-Type': 'application/json' } });
    });
    renderCallback({
      path: '/sso/callback?code=strict-mode-handoff-code32',
      meAfter: meStaff(),
      fetchImpl,
      signInWithCustomToken,
      strict: true,
    });
    await waitFor(() => expect(signInWithCustomToken).toHaveBeenCalledWith('strict-custom-token'));
    expect(
      fetchImpl.mock.calls.filter((call) => String(call[0]).includes('/auth/sso/exchange')),
    ).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: 'Staff dashboard navigation' })).toBeInTheDocument(),
    );
  });

  it('keeps an authenticated staff session on refresh', () => {
    render(
      <ToastProvider>
        <FakeAuthProvider me={meStaff()}>
          <MemoryRouter initialEntries={['/']}>
            <Gate />
          </MemoryRouter>
        </FakeAuthProvider>
      </ToastProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('shows a recoverable error when the callback code is missing', async () => {
    renderCallback({ path: '/sso/callback' });
    expect(await screen.findByText(/sign-in link is missing or incomplete/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return to SERVE' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('shows a recoverable error when the one-time code is rejected', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'SSO_CODE_INVALID', message: 'This sign-in link is invalid or has expired.' },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    renderCallback({ path: '/sso/callback?code=already-used-or-expiredxx', fetchImpl });
    expect(await screen.findByText('This sign-in link is invalid or has expired.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return to SERVE' })).toBeInTheDocument();
  });
});
