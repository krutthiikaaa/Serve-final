import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthProvider,
  PASSWORD_REQUIRED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  SESSION_RESTORE_TIMEOUT_MS,
  passwordChangeErrorMessage,
  signInErrorMessage,
  useAuth,
} from '../src/auth';
import { ChangePasswordForm, PasswordSignIn, newPasswordProblem } from '../src/auth-screens';

/**
 * AuthProvider against a stubbed SERVE backend (fetch): Better Auth's
 * get-session / sign-in/email / change-password / sign-out and SERVE's
 * /api/auth/me. Staff and admins sign in with email + password only.
 */
const API = 'http://localhost:5001';

const STAFF_ME = {
  registered: true,
  role: 'STAFF',
  id: '00000000-0000-4000-8000-000000000001',
  authUserId: 'u1',
  name: 'Ravi',
  email: 'ravi@gmail.com',
  isActive: true,
  status: 'PENDING',
  canteen: null,
  assignments: [],
  pendingChangeRequest: null,
};

interface Backend {
  session: { user: { email: string; name: string } } | null;
  me: unknown;
  meStatus?: number;
  meCode?: string;
  /** Status and body for POST /sign-in/email (default: success). */
  signIn?: { status: number; body: unknown };
  /** Status and body for POST /change-password (default: success). */
  change?: { status: number; body: unknown };
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
        ? json(backend.meStatus, {
            error: { code: backend.meCode ?? 'AUTH_REQUIRED', message: 'x' },
          })
        : json(200, { data: backend.me });
    }
    if (url === `${API}/api/auth/sign-in/email`) {
      if (backend.signIn) return json(backend.signIn.status, backend.signIn.body);
      const { email } = JSON.parse(String(init?.body)) as { email: string };
      backend.session = { user: { email, name: 'Ravi' } };
      return json(200, {
        redirect: false,
        token: 'hidden',
        user: { id: 'u1', email, name: 'Ravi' },
      });
    }
    if (url === `${API}/api/auth/change-password`) {
      if (backend.change) return json(backend.change.status, backend.change.body);
      return json(200, { token: null, user: { id: 'u1' } });
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
  const [result, setResult] = useState('');
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="email">{auth.user?.email ?? ''}</span>
      <span data-testid="error">{auth.signInError ?? ''}</span>
      <span data-testid="result">{result}</span>
      <button
        onClick={() =>
          void auth
            .signInWithPassword(' ravi@gmail.com ', 'correct-horse-battery')
            .then((ok) => setResult(String(ok)))
        }
      >
        password
      </button>
      <button
        onClick={() =>
          void auth
            .changePassword({ currentPassword: 'old-password-1', newPassword: 'new-password-1' })
            .then(
              () => setResult('changed'),
              (err: Error) => setResult(`failed: ${err.message}`),
            )
        }
      >
        change
      </button>
      <button onClick={() => void auth.signOut()}>out</button>
      <button onClick={() => void auth.api.get('/orders').catch(() => undefined)}>orders</button>
      <button onClick={() => void auth.refreshMe()}>recheck</button>
    </div>
  );
}

const renderAuth = () =>
  render(
    <AuthProvider baseUrl={API}>
      <Probe />
    </AuthProvider>,
  );

const signedIn = (): Backend => ({
  session: { user: { email: 'ravi@gmail.com', name: 'Ravi' } },
  me: STAFF_ME,
});

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

  it('an unreachable backend ends in "error" (not an endless spinner), and Retry recovers', async () => {
    // Connection refused: Better Auth's fetch throws instead of returning `{ error }`.
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    // Backend is back with no session: retry lands on sign-in.
    stubBackend({ session: null, me: null, meStatus: 401 });
    fireEvent.click(screen.getByText('recheck'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    expect(screen.getByTestId('error')).toHaveTextContent('');
  });

  it('a backend that never answers the session check times out into "error"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.stubGlobal('fetch', () => new Promise<Response>(() => undefined));
      renderAuth();
      expect(screen.getByTestId('status')).toHaveTextContent('initializing');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SESSION_RESTORE_TIMEOUT_MS + 1);
      });
      expect(screen.getByTestId('status')).toHaveTextContent('error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores a session and loads the backend account', async () => {
    stubBackend(signedIn());
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('email')).toHaveTextContent('ravi@gmail.com');
  });

  it('signs in with email and password, then loads the backend account', async () => {
    const calls = stubBackend({ session: null, me: STAFF_ME });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    await act(async () => screen.getByText('password').click());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('result')).toHaveTextContent('true');
    const signIn = calls.find((c) => c.url === `${API}/api/auth/sign-in/email`)!;
    expect(signIn.init?.method).toBe('POST');
    expect(signIn.init?.credentials).toBe('include');
    expect(JSON.parse(String(signIn.init?.body))).toMatchObject({
      email: 'ravi@gmail.com',
      password: 'correct-horse-battery',
    });
    expect(calls.some((c) => c.url === `${API}/api/auth/me`)).toBe(true);
    // Never Google.
    expect(calls.some((c) => c.url.includes('sign-in/social'))).toBe(false);
  });

  it('explains a refused sign-in and stays signed out', async () => {
    stubBackend({
      session: null,
      me: null,
      signIn: {
        status: 401,
        body: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
      },
    });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    await act(async () => screen.getByText('password').click());
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('false'));
    expect(screen.getByTestId('error')).toHaveTextContent('Incorrect email or password.');
    expect(screen.getByTestId('status')).toHaveTextContent('signedOut');
  });

  it('explains rate limiting (SERVE error envelope)', async () => {
    stubBackend({
      session: null,
      me: null,
      signIn: { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'Slow down' } } },
    });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    await act(async () => screen.getByText('password').click());
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent(/Too many sign-in/));
  });

  it('signs out through Better Auth', async () => {
    const calls = stubBackend(signedIn());
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    await act(async () => screen.getByText('out').click());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    expect(calls.some((c) => c.url === `${API}/api/auth/sign-out`)).toBe(true);
  });

  it('a session the backend no longer accepts ends signed out', async () => {
    stubBackend({ ...signedIn(), me: null, meStatus: 401 });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
  });

  it('a session refused for its sign-in method asks for the password', async () => {
    stubBackend({ ...signedIn(), meStatus: 401, meCode: 'SIGN_IN_METHOD_NOT_ALLOWED' });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    expect(screen.getByTestId('error')).toHaveTextContent(PASSWORD_REQUIRED_MESSAGE);
  });

  it('explains every refusal in plain language, never internals', () => {
    expect(signInErrorMessage('INVALID_EMAIL_OR_PASSWORD')).toBe('Incorrect email or password.');
    expect(signInErrorMessage('STAFF_ADMIN_USE_PASSWORD')).toBe(PASSWORD_REQUIRED_MESSAGE);
    expect(signInErrorMessage('RATE_LIMITED')).toMatch(/Too many sign-in attempts/);
    expect(signInErrorMessage('SESSION_EXPIRED')).toBe(SESSION_EXPIRED_MESSAGE);
    expect(signInErrorMessage('internal_server_error: stack…')).toBe(
      'Sign-in failed. Please try again.',
    );
    expect(passwordChangeErrorMessage('INVALID_PASSWORD')).toBe(
      'Your current password is incorrect.',
    );
    expect(passwordChangeErrorMessage('PASSWORD_TOO_SHORT')).toMatch(/at least 10/);
    expect(passwordChangeErrorMessage('weird')).toBe(
      'The password could not be changed. Please try again.',
    );
  });

  it('a session that ends mid-use signs out with "session expired"', async () => {
    const backend = signedIn();
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
    const backend = signedIn();
    stubBackend(backend);
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    backend.meStatus = 401;
    await act(async () => screen.getByText('recheck').click());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    expect(screen.getByTestId('error')).toHaveTextContent(SESSION_EXPIRED_MESSAGE);
  });

  it('a deliberate sign-out and a first visit show no expiry message', async () => {
    stubBackend(signedIn());
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    await act(async () => screen.getByText('out').click());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    expect(screen.getByTestId('error')).toHaveTextContent('');
  });

  it('changes the password, signing out other devices', async () => {
    const calls = stubBackend(signedIn());
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    await act(async () => screen.getByText('change').click());
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('changed'));
    const change = calls.find((c) => c.url === `${API}/api/auth/change-password`)!;
    expect(JSON.parse(String(change.init?.body))).toEqual({
      currentPassword: 'old-password-1',
      newPassword: 'new-password-1',
      revokeOtherSessions: true,
    });
    expect(screen.getByTestId('status')).toHaveTextContent('ready');
  });

  it('explains a refused password change and stays signed in', async () => {
    const backend = signedIn();
    backend.change = { status: 400, body: { code: 'INVALID_PASSWORD', message: 'Invalid' } };
    stubBackend(backend);
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    await act(async () => screen.getByText('change').click());
    await waitFor(() =>
      expect(screen.getByTestId('result')).toHaveTextContent(
        'failed: Your current password is incorrect.',
      ),
    );
    expect(screen.getByTestId('status')).toHaveTextContent('ready');
  });
});

describe('PasswordSignIn form', () => {
  it('has email and password fields and no Google option', () => {
    render(<PasswordSignIn onSignIn={() => Promise.resolve(true)} />);
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.queryByText(/google/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('submits the credentials and stays busy while signing in', async () => {
    const onSignIn = vi.fn((_email: string, _password: string) => new Promise<boolean>(() => {}));
    render(<PasswordSignIn onSignIn={onSignIn} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ravi@gmail.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-pass-1' } });
    const button = screen.getByRole('button', { name: 'Sign in' });
    fireEvent.click(button);
    expect(onSignIn).toHaveBeenCalledWith('ravi@gmail.com', 'secret-pass-1');
    await waitFor(() => expect(button).toBeDisabled());
  });

  it('shows the refusal and becomes usable again', async () => {
    render(
      <PasswordSignIn
        onSignIn={() => Promise.resolve(false)}
        error="Incorrect email or password."
      />,
    );
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ravi@gmail.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-pass' } });
    const button = screen.getByRole('button', { name: 'Sign in' });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });
});

describe('ChangePasswordForm', () => {
  const fill = (current: string, next: string, confirm: string) => {
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: confirm },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  };

  it('checks length, confirmation and reuse before calling the backend', async () => {
    const onChange = vi.fn(() => Promise.resolve());
    render(<ChangePasswordForm onChange={onChange} />);
    fill('old-password-1', 'short', 'short');
    expect(await screen.findByText('Use at least 10 characters.')).toBeInTheDocument();
    fill('old-password-1', 'new-password-1', 'new-password-2');
    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();
    fill('old-password-1', 'old-password-1', 'old-password-1');
    expect(await screen.findByText(/different from the current one/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('changes the password, confirms it and clears the fields', async () => {
    const onChange = vi.fn(() => Promise.resolve());
    render(<ChangePasswordForm onChange={onChange} />);
    fill('old-password-1', 'new-password-1', 'new-password-1');
    expect(await screen.findByRole('status')).toHaveTextContent('Password changed.');
    expect(onChange).toHaveBeenCalledWith({
      currentPassword: 'old-password-1',
      newPassword: 'new-password-1',
    });
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('shows why the backend refused it', async () => {
    render(
      <ChangePasswordForm
        onChange={() => Promise.reject(new Error('Your current password is incorrect.'))}
      />,
    );
    fill('wrong-password', 'new-password-1', 'new-password-1');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your current password is incorrect.',
    );
  });

  it('validates new passwords like the backend', () => {
    expect(newPasswordProblem('123456789', '123456789')).toMatch(/at least 10/);
    expect(newPasswordProblem('x'.repeat(129), 'x'.repeat(129))).toMatch(/at most 128/);
    expect(newPasswordProblem('long-enough-1', 'long-enough-2')).toMatch(/do not match/);
    expect(newPasswordProblem('long-enough-1', 'long-enough-1')).toBeNull();
  });
});
