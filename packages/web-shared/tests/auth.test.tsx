import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, SESSION_EXPIRED_MESSAGE, signInErrorMessage, useAuth } from '../src/auth';
import { GoogleSignIn } from '../src/auth-screens';

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
  /** Status and Better Auth error code for POST /sign-in/social. */
  social?: { status: number; code: string };
  /** Every other SERVE API call answers 401 (session ended server-side). */
  sessionEnded?: boolean;
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
      if (backend.social) {
        return json(backend.social.status, { code: backend.social.code, message: 'refused' });
      }
      return json(200, { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', redirect: true });
    }
    if (backend.sessionEnded && url.startsWith(`${API}/api/`)) {
      return json(401, { error: { code: 'AUTH_REQUIRED', message: 'x' } });
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
  const [started, setStarted] = useState('');
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="email">{auth.user?.email ?? ''}</span>
      <span data-testid="error">{auth.signInError ?? ''}</span>
      <span data-testid="started">{started}</span>
      <button onClick={() => void auth.signInWithGoogle().then((ok) => setStarted(String(ok)))}>
        google
      </button>
      <button onClick={() => void auth.signOut()}>out</button>
      <button onClick={() => void auth.api.get('/orders').catch(() => undefined)}>orders</button>
      <button onClick={() => void auth.refreshMe()}>recheck</button>
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

  it('explains every refusal in plain language, never internals', () => {
    expect(signInErrorMessage('EMAIL_DOMAIN_NOT_ALLOWED')).toBe(
      'This account is not eligible to use SERVE. Please sign in using your SRM AP institutional account (@srmap.edu.in).',
    );
    expect(signInErrorMessage('EMAIL_NOT_VERIFIED')).toMatch(/^Your account could not be verified/);
    expect(signInErrorMessage('account_not_linked')).toMatch(/not the one linked/);
    expect(signInErrorMessage('access_denied')).toBe('Google sign-in was cancelled.');
    expect(signInErrorMessage('SESSION_EXPIRED')).toBe(
      'Your session expired. Please sign in again.',
    );
    expect(signInErrorMessage('internal_server_error: stack…')).toBe(
      'Authentication failed. Please try again.',
    );
  });

  it('a session that ends mid-use signs out with "session expired"', async () => {
    const backend: Backend = {
      session: { user: { email: 'asha@srmap.edu.in', name: 'Asha' } },
      me: { registered: false, role: null, authUserId: 'u1', email: 'asha@srmap.edu.in' },
    };
    stubBackend(backend);
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    backend.sessionEnded = true;
    await act(async () => screen.getByText('orders').click());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    expect(screen.getByTestId('error')).toHaveTextContent(SESSION_EXPIRED_MESSAGE);
    expect(screen.getByTestId('email')).toHaveTextContent('');
  });

  it('a re-check (e.g. after realtime auth.expired) that finds no session also explains it', async () => {
    const backend: Backend = {
      session: { user: { email: 'asha@srmap.edu.in', name: 'Asha' } },
      me: { registered: false, role: null, authUserId: 'u1', email: 'asha@srmap.edu.in' },
    };
    stubBackend(backend);
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    backend.meStatus = 401;
    await act(async () => screen.getByText('recheck').click());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    expect(screen.getByTestId('error')).toHaveTextContent(SESSION_EXPIRED_MESSAGE);
  });

  it('a deliberate sign-out and a first visit show no expiry message', async () => {
    stubBackend({
      session: { user: { email: 'asha@srmap.edu.in', name: 'Asha' } },
      me: { registered: false, role: null, authUserId: 'u1', email: 'asha@srmap.edu.in' },
    });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    await act(async () => screen.getByText('out').click());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    expect(screen.getByTestId('error')).toHaveTextContent('');
  });

  it('reports whether Google sign-in started, with the reason when it did not', async () => {
    const backend: Backend = { session: null, me: null };
    stubBackend(backend);
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    backend.social = { status: 403, code: 'EMAIL_DOMAIN_NOT_ALLOWED' };
    await act(async () => screen.getByText('google').click());
    await waitFor(() => expect(screen.getByTestId('started')).toHaveTextContent('false'));
    expect(screen.getByTestId('error')).toHaveTextContent(/not eligible to use SERVE/);
  });
});

describe('GoogleSignIn button', () => {
  it('stays busy while the browser leaves for Google', async () => {
    let finish: (value: boolean) => void = () => undefined;
    render(<GoogleSignIn onSignIn={() => new Promise<boolean>((r) => (finish = r))} />);
    const button = screen.getByRole('button', { name: /continue with google/i });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    await act(async () => finish(true));
    expect(button).toBeDisabled();
  });

  it('becomes usable again when sign-in could not start', async () => {
    render(<GoogleSignIn onSignIn={() => Promise.resolve(false)} error="Refused" />);
    const button = screen.getByRole('button', { name: /continue with google/i });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByText('Refused')).toBeInTheDocument();
  });

  it('explains a network failure and becomes usable again', async () => {
    render(<GoogleSignIn onSignIn={() => Promise.reject(new Error('offline'))} />);
    const button = screen.getByRole('button', { name: /continue with google/i });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/Unable to reach SERVE/)).toBeInTheDocument());
    expect(button).toBeEnabled();
  });
});
