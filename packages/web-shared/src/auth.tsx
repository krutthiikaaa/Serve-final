import { createAuthClient } from 'better-auth/client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Me } from '@serve/contracts';
import { ApiClient, ApiError } from './api';
import { ssoLog } from './sso-log';

export type AuthStatus = 'initializing' | 'signedOut' | 'loadingAccount' | 'ready' | 'error';

/** The signed-in identity (staff dashboard and admin portal: email + password). */
export interface AuthUser {
  email: string;
  displayName: string | null;
}

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** The account as known to the backend (`GET /api/auth/me`). Never derived from the session. */
  me: Me | null;
  error: unknown;
  /** Why the last sign-in was refused, or why the session ended, for the sign-in screen. */
  signInError: string | null;
}

export interface PasswordChange {
  currentPassword: string;
  newPassword: string;
}

export interface AuthContextValue extends AuthState {
  api: ApiClient;
  /**
   * Email + password sign-in (staff and admins). Resolves true when signed in
   * (the account is then loaded), false when refused (`signInError` says why).
   */
  signInWithPassword(email: string, password: string): Promise<boolean>;
  /**
   * Changes the signed-in account's password (the current one is required).
   * Every other session of the account is signed out; this one stays signed
   * in. Rejects with an ApiError whose message is safe to show.
   */
  changePassword(change: PasswordChange): Promise<void>;
  signOut(): Promise<void>;
  /** Re-read `/api/auth/me` (after registration, approval, reconnect…). */
  refreshMe(): Promise<Me | null>;
  /** Web apps authenticate with the HttpOnly session cookie: there is no token to read. */
  getToken(): Promise<string | null>;
}

/** Exported for tests (see `@serve/web-shared/testing`). Apps use AuthProvider. */
export const AuthContext = createContext<AuthContextValue | null>(null);

/** Shown when a session that was working ends (expired, signed out elsewhere, revoked). */
export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Please sign in again.';

/** Shown when the backend refuses a session created with the wrong sign-in method. */
export const PASSWORD_REQUIRED_MESSAGE =
  'Staff and admins sign in with their email and password. Please sign in again.';

/**
 * Plain-language reasons for sign-in error codes (Better Auth and SERVE).
 * Never internal details: unknown codes get the generic message.
 */
export function signInErrorMessage(code: string): string {
  switch (code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_EMAIL':
      return 'Incorrect email or password.';
    case 'STAFF_ADMIN_USE_PASSWORD':
    case 'SIGN_IN_METHOD_NOT_ALLOWED':
      return PASSWORD_REQUIRED_MESSAGE;
    case 'RATE_LIMITED':
    case 'TOO_MANY_REQUESTS':
      return 'Too many sign-in attempts. Wait a minute, then try again.';
    case 'NETWORK_ERROR':
      return 'Unable to reach SERVE. Check your connection.';
    case 'SESSION_EXPIRED':
      return SESSION_EXPIRED_MESSAGE;
    default:
      return 'Sign-in failed. Please try again.';
  }
}

/** Plain-language reasons a password change was refused. */
export function passwordChangeErrorMessage(code: string): string {
  switch (code) {
    case 'INVALID_PASSWORD':
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'Your current password is incorrect.';
    case 'PASSWORD_TOO_SHORT':
      return 'The new password is too short (at least 10 characters).';
    case 'PASSWORD_TOO_LONG':
      return 'The new password is too long (at most 128 characters).';
    case 'RATE_LIMITED':
    case 'TOO_MANY_REQUESTS':
      return 'Too many attempts. Wait a minute, then try again.';
    case 'PASSWORD_CHANGE_NOT_ALLOWED':
      return 'This account has no password to change.';
    case 'ACCOUNT_DISABLED':
      return 'This account is disabled.';
    case 'NETWORK_ERROR':
      return 'Unable to reach SERVE. Check your connection.';
    default:
      return 'The password could not be changed. Please try again.';
  }
}

/** The error code of a Better Auth client error (its own `code`, or SERVE's `{ error: { code } }`). */
function errorCodeOf(error: unknown): string {
  if (!error || typeof error !== 'object') return 'UNKNOWN';
  const value = error as { code?: unknown; status?: unknown; error?: { code?: unknown } };
  if (typeof value.code === 'string' && value.code) return value.code;
  if (typeof value.error?.code === 'string') return value.error.code;
  if (value.status === 429) return 'RATE_LIMITED';
  if (value.status === 0 || value.status === undefined) return 'NETWORK_ERROR';
  return 'UNKNOWN';
}

function statusOf(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : 0;
}

/**
 * Better Auth proves identity (email + password for staff and admins); the
 * backend decides the role and refuses any other sign-in method for these
 * accounts. The provider keeps the session and the backend account (`me`)
 * in one state machine:
 * initializing → signedOut | loadingAccount → ready | error.
 *
 * The session is an HttpOnly cookie set by the SERVE backend.
 */
export function AuthProvider({
  baseUrl,
  children,
}: {
  /** Backend origin (the API and Better Auth live there). */
  baseUrl: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<AuthState>({
    status: 'initializing',
    user: null,
    me: null,
    error: null,
    signInError: null,
  });
  const signedIn = useRef(false);

  const authClient = useMemo(
    () =>
      createAuthClient({
        baseURL: baseUrl,
        basePath: '/api/auth',
        fetchOptions: { credentials: 'include' },
      }),
    [baseUrl],
  );

  /**
   * Signed out. A session that had been working ends with an explanation;
   * one refused for its sign-in method says so.
   */
  const toSignedOut = useCallback((code?: string) => {
    const expired = signedIn.current;
    signedIn.current = false;
    setState((s) => ({
      ...s,
      status: 'signedOut',
      user: null,
      me: null,
      error: null,
      signInError:
        code === 'SIGN_IN_METHOD_NOT_ALLOWED'
          ? PASSWORD_REQUIRED_MESSAGE
          : expired
            ? SESSION_EXPIRED_MESSAGE
            : s.signInError,
    }));
  }, []);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl,
        // Session expired, signed out elsewhere or refused: back to sign-in.
        onUnauthorized: toSignedOut,
      }),
    [baseUrl, toSignedOut],
  );

  const loadMe = useCallback(async (): Promise<Me | null> => {
    setState((s) => ({
      ...s,
      status: s.status === 'ready' ? 'ready' : 'loadingAccount',
      error: null,
    }));
    try {
      const me = await api.get<Me>('/auth/me');
      ssoLog('auth/me', {
        ok: true,
        registered: me.registered,
        role: me.registered ? me.role : null,
      });
      signedIn.current = true;
      setState((s) => ({
        ...s,
        status: 'ready',
        me,
        user: s.user ?? { email: me.email ?? '', displayName: me.registered ? me.name : null },
        error: null,
        signInError: null,
      }));
      return me;
    } catch (error) {
      ssoLog('auth/me', {
        ok: false,
        status: error instanceof ApiError ? error.status : undefined,
      });
      if (error instanceof ApiError && error.status === 401) {
        toSignedOut(error.code);
        return null;
      }
      setState((s) => ({ ...s, status: 'error', error }));
      return null;
    }
  }, [api, toSignedOut]);

  // Restore the session on load.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await authClient.getSession();
      if (cancelled) return;
      if (error && error.status !== 401) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: new ApiError(
            error.status ?? 0,
            'AUTH_UNAVAILABLE',
            'Unable to reach SERVE. Check your connection.',
          ),
        }));
        return;
      }
      if (!data) return toSignedOut();
      setState((s) => ({
        ...s,
        status: 'loadingAccount',
        user: { email: data.user.email, displayName: data.user.name || null },
      }));
      await loadMe();
    })();
    return () => {
      cancelled = true;
    };
  }, [authClient, loadMe, toSignedOut]);

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      setState((s) => ({ ...s, signInError: null }));
      let result: Awaited<ReturnType<typeof authClient.signIn.email>>;
      try {
        result = await authClient.signIn.email({ email: email.trim(), password });
      } catch {
        setState((s) => ({ ...s, signInError: signInErrorMessage('NETWORK_ERROR') }));
        return false;
      }
      if (result.error || !result.data) {
        setState((s) => ({ ...s, signInError: signInErrorMessage(errorCodeOf(result.error)) }));
        return false;
      }
      const { user } = result.data;
      setState((s) => ({
        ...s,
        status: 'loadingAccount',
        user: { email: user.email, displayName: user.name || null },
      }));
      return (await loadMe()) !== null;
    },
    [authClient, loadMe],
  );

  const changePassword = useCallback(
    async ({ currentPassword, newPassword }: PasswordChange) => {
      let result: Awaited<ReturnType<typeof authClient.changePassword>>;
      try {
        result = await authClient.changePassword({
          currentPassword,
          newPassword,
          // Anyone who knew the old password is signed out everywhere else.
          revokeOtherSessions: true,
        });
      } catch {
        throw new ApiError(0, 'NETWORK_ERROR', passwordChangeErrorMessage('NETWORK_ERROR'));
      }
      if (result.error) {
        const code = errorCodeOf(result.error);
        const status = statusOf(result.error);
        // The session itself ended (expired, revoked, wrong sign-in method).
        if (status === 401 && code !== 'INVALID_PASSWORD') {
          toSignedOut(code);
        }
        throw new ApiError(status, code, passwordChangeErrorMessage(code));
      }
    },
    [authClient, toSignedOut],
  );

  const signOut = useCallback(async () => {
    // A deliberate sign-out is not an expired session: no message.
    signedIn.current = false;
    setState((s) => ({ ...s, signInError: null }));
    try {
      await authClient.signOut();
    } finally {
      toSignedOut();
    }
  }, [authClient, toSignedOut]);

  const getToken = useCallback(() => Promise.resolve(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      api,
      getToken,
      refreshMe: loadMe,
      signInWithPassword,
      changePassword,
      signOut,
    }),
    [state, api, getToken, loadMe, signInWithPassword, changePassword, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** True when `error` means the backend is unreachable rather than "not allowed". */
export function isConnectivityError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status === 503);
}
