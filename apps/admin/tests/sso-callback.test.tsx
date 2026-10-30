import { StrictMode, useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Me } from '@serve/contracts';
import { ApiClient, ToastProvider } from '@serve/web-shared';
import { FakeAuthProvider } from '@serve/web-shared/testing';
import { Gate } from '../src/App';
import { meAdmin } from './fixtures';

vi.mock('socket.io-client', () => ({
  io: () => ({ on() {}, off() {}, removeAllListeners() {}, disconnect() {}, connect() {} }),
}));

function renderCallback({
  path,
  meAfter,
  fetchImpl,
  signInWithCustomToken,
  strict = false,
}: {
  path: string;
  meAfter?: Me | null;
  fetchImpl?: typeof fetch;
  signInWithCustomToken?: (token: string) => Promise<void>;
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
              getToken: async () => null,
              fetchImpl:
                fetchImpl ??
                (async () => new Response('{}', { status: 599, headers: { 'Content-Type': 'application/json' } })),
            }),
            signInWithCustomToken: async (token: string) => {
              if (signInWithCustomToken) await signInWithCustomToken(token);
              if (meAfter) setMe(meAfter);
            },
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

describe('admin SSO callback', () => {
  it('exchanges the code, signs in with a Custom Token, and opens the portal', async () => {
    const signInWithCustomToken = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        code: 'admin-handoff-code-value32x',
        audience: 'ADMIN',
      });
      return new Response(JSON.stringify({ data: { customToken: 'admin-custom-token' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    renderCallback({
      path: '/sso/callback?code=admin-handoff-code-value32x',
      meAfter: meAdmin(),
      fetchImpl,
      signInWithCustomToken,
    });
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    await waitFor(() => expect(signInWithCustomToken).toHaveBeenCalledWith('admin-custom-token'));
    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: 'Admin portal navigation' })).toBeInTheDocument(),
    );
    const sidebar = within(screen.getByRole('complementary', { name: 'Admin portal navigation' }));
    expect(sidebar.getByRole('link', { name: /^Dashboard/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('keeps an authenticated admin session on refresh', () => {
    render(
      <ToastProvider>
        <FakeAuthProvider me={meAdmin()}>
          <MemoryRouter initialEntries={['/']}>
            <Gate />
          </MemoryRouter>
        </FakeAuthProvider>
      </ToastProvider>,
    );
    expect(screen.getByRole('complementary', { name: 'Admin portal navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('exchanges a one-time code only once under React Strict Mode', async () => {
    const signInWithCustomToken = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/auth/sso/exchange')) {
        return new Response(JSON.stringify({ data: { customToken: 'admin-strict-token' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 599, headers: { 'Content-Type': 'application/json' } });
    });
    renderCallback({
      path: '/sso/callback?code=admin-strict-handoff-code32',
      meAfter: meAdmin(),
      fetchImpl,
      signInWithCustomToken,
      strict: true,
    });
    await waitFor(() => expect(signInWithCustomToken).toHaveBeenCalledWith('admin-strict-token'));
    expect(
      fetchImpl.mock.calls.filter((call) => String(call[0]).includes('/auth/sso/exchange')),
    ).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: 'Admin portal navigation' })).toBeInTheDocument(),
    );
  });

  it('shows a recoverable error when the callback is invalid', async () => {
    renderCallback({ path: '/sso/callback' });
    expect(await screen.findByRole('button', { name: 'Return to SERVE' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});
