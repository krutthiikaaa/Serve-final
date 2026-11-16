import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, signInErrorMessage, useAuth } from '../src/auth';

/**
 * AuthProvider against a stubbed SERVE backend (fetch): Better Auth's
 * get-session / sign-in/social / sign-out and SERVE's /api/auth/me.
 */
const API = 'http://localhost:5001';
const APP = 'http://localhost:5173/';

interface Backend {
  session: { user: { email: string; name: string } } | null;
  me: unknown;
  meStatus?: number;
}

function stubBackend(backend: Backend) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url.startsWith(`${API}/api/auth/get-session`)) {
      return json(200, backend.session ? { ...backend.session, session: { id: 's' } } : null);
    }
    if (url === `${API}/api/auth/me`) {
      return backend.meStatus
        ? json(backend.meStatus, { error: { code: 'AUTH_REQUIRED', message: 'x' } })
        : json(200, { data: backend.me });
    }
    if (url === `${API}/api/auth/sign-in/social`) {
      return json(200, { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', redirect: true });
    }
    if (url === `${API}/api/auth/sign-out`) {
      backend.session = null;
      return json(200, { success: true });
    }
    return json(404, {});
  });
  return calls;
}

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="email">{auth.user?.email ?? ''}</span>
      <span data-testid="error">{auth.signInError ?? ''}</span>
      <button onClick={() => void auth.signInWithGoogle()}>google</button>
      <button onClick={() => void auth.signOut()}>out</button>
    </div>
  );
}

const renderAuth = () =>
  render(
    <AuthProvider baseUrl={API} appUrl={APP}>
      <Probe />
    </AuthProvider>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('AuthProvider (Better Auth session)', () => {
  it('is signed out without a session and never calls /me', async () => {
    const calls = stubBackend({ session: null, me: null });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    expect(calls.some((c) => c.url.endsWith('/api/auth/me'))).toBe(false);
    // Better Auth requests carry the session cookie.
    expect(calls[0]?.init?.credentials).toBe('include');
  });

  it('restores a session and loads the backend account', async () => {
    stubBackend({
      session: { user: { email: 'asha@srmap.edu.in', name: 'Asha' } },
      me: { registered: false, role: null, authUserId: 'u1', email: 'asha@srmap.edu.in' },
    });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('email')).toHaveTextContent('asha@srmap.edu.in');
  });

  it('starts Google sign-in with this app as the return address', async () => {
    const calls = stubBackend({ session: null, me: null });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    await act(async () => screen.getByText('google').click());
    const social = calls.find((c) => c.url === `${API}/api/auth/sign-in/social`)!;
    expect(JSON.parse(String(social.init?.body))).toMatchObject({
      provider: 'google',
      callbackURL: APP,
      errorCallbackURL: APP,
    });
  });

  it('shows why Google sign-in was refused and removes the error from the URL', async () => {
    window.history.replaceState(null, '', '/?error=EMAIL_DOMAIN_NOT_ALLOWED');
    stubBackend({ session: null, me: null });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent(/@srmap\.edu\.in/));
    expect(window.location.search).toBe('');
  });

  it('signs out through Better Auth', async () => {
    const calls = stubBackend({
      session: { user: { email: 'asha@srmap.edu.in', name: 'Asha' } },
      me: { registered: false, role: null, authUserId: 'u1', email: 'asha@srmap.edu.in' },
    });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    await act(async () => screen.getByText('out').click());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    expect(calls.some((c) => c.url === `${API}/api/auth/sign-out`)).toBe(true);
  });

  it('a session the backend no longer accepts ends signed out', async () => {
    stubBackend({
      session: { user: { email: 'a@srmap.edu.in', name: 'A' } },
      me: null,
      meStatus: 401,
    });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
  });

  it('explains every refusal in plain language', () => {
    expect(signInErrorMessage('EMAIL_NOT_VERIFIED')).toMatch(/not verified/);
    expect(signInErrorMessage('account_not_linked')).toMatch(/not the one linked/);
    expect(signInErrorMessage('anything-else')).toMatch(/did not complete/);
  });
});
