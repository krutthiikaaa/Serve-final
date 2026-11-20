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

/** The signed-in Google identity (a verified @srmap.edu.in account). */
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
  /** Why the last Google sign-in was refused (e.g. a non-SRM account), for the sign-in screen. */
  signInError: string | null;
}

export interface AuthContextValue extends AuthState {
  api: ApiClient;
  /**
   * Starts Google sign-in. Resolves true when the browser is leaving for
   * Google (it comes back signed in), false when sign-in could not start
   * (`signInError` says why).
   */
  signInWithGoogle(): Promise<boolean>;
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

/**
 * Plain-language reasons for Better Auth / SERVE sign-in error codes. Never
 * internal details: unknown codes get the generic message.
 */
export function signInErrorMessage(code: string): string {
  switch (code) {
    case 'EMAIL_DOMAIN_NOT_ALLOWED':
    case 'SIGN_IN_METHOD_NOT_ALLOWED':
      return 'This account is not eligible to use SERVE. Please sign in using your SRM AP institutional account (@srmap.edu.in).';
    case 'EMAIL_NOT_VERIFIED':
      return 'Your account could not be verified. Make sure your Google account email is verified, then try again.';
    case 'account_not_linked':
      return 'This Google account is not the one linked to your SERVE account. Ask a SERVE administrator for help.';
    case 'access_denied':
      return 'Google sign-in was cancelled.';
    case 'SESSION_EXPIRED':
      return SESSION_EXPIRED_MESSAGE;
    default:
      return 'Authentication failed. Please try again.';
  }
}

/** Reads and removes `?error=` that Better Auth adds after a refused Google sign-in. */
function takeSignInError(): string | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const code = url.searchParams.get('error');
  if (!code) return null;
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  window.history.replaceState(window.history.state, '', url.toString());
  return signInErrorMessage(code);
}

/**
 * Better Auth proves identity (Google, verified @srmap.edu.in); the backend
 * decides the role. The provider keeps the session and the backend account
 * (`me`) in one state machine:
 * initializing → signedOut | loadingAccount → ready | error.
 *
 * The session is an HttpOnly cookie set by the SERVE backend, shared by the
 * student app, staff dashboard and admin portal (one sign-in for all three).
 */
export function AuthProvider({
  baseUrl,
  appUrl,
  children,
}: {
  /** Backend origin (the API and Better Auth live there). */
  baseUrl: string;
  /** Where Google sign-in returns to: this app's root URL. */
  appUrl: string;
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

  /** Signed out; a session that had been working ends with an explanation. */
  const toSignedOut = useCallback(() => {
    const expired = signedIn.current;
    signedIn.current = false;
    setState((s) => ({
      ...s,
      status: 'signedOut',
      user: null,
      me: null,
      error: null,
      signInError: expired ? SESSION_EXPIRED_MESSAGE : s.signInError,
    }));
  }, []);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl,
        // Session expired or signed out elsewhere: back to the sign-in screen.
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
      }));
      return me;
    } catch (error) {
      ssoLog('auth/me', {
        ok: false,
        status: error instanceof ApiError ? error.status : undefined,
      });
      if (error instanceof ApiError && error.status === 401) {
        toSignedOut();
        return null;
      }
      setState((s) => ({ ...s, status: 'error', error }));
      return null;
    }
  }, [api, toSignedOut]);

  // Restore the session on load (and after returning from Google).
  useEffect(() => {
    let cancelled = false;
    const signInError = takeSignInError();
    if (signInError) setState((s) => ({ ...s, signInError }));
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

  const signInWithGoogle = useCallback(async () => {
    setState((s) => ({ ...s, signInError: null }));
    const { error } = await authClient.signIn.social({
      provider: 'google',
      callbackURL: appUrl,
      // Better Auth appends ?error=<code> (see takeSignInError).
      errorCallbackURL: appUrl,
    });
    if (error) {
      setState((s) => ({ ...s, signInError: signInErrorMessage(error.code ?? '') }));
      return false;
    }
    return true;
  }, [authClient, appUrl]);

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
    () => ({ ...state, api, getToken, refreshMe: loadMe, signInWithGoogle, signOut }),
    [state, api, getToken, loadMe, signInWithGoogle, signOut],
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
