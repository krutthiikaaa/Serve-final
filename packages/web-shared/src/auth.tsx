import {
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from '@firebase/auth';
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

export type AuthStatus = 'initializing' | 'signedOut' | 'loadingAccount' | 'ready' | 'error';

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** The account as known to the backend (`GET /api/auth/me`). Never derived from the token. */
  me: Me | null;
  error: unknown;
}

export interface AuthContextValue extends AuthState {
  api: ApiClient;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Re-read `/api/auth/me` (after registration, approval, reconnect…). */
  refreshMe(): Promise<Me | null>;
  getToken(forceRefresh?: boolean): Promise<string | null>;
}

/** Exported for tests (see `@serve/web-shared/testing`). Apps use AuthProvider. */
export const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Firebase proves identity; the backend decides the role. The provider keeps
 * the Firebase user and the backend account (`me`) in one state machine:
 * initializing → signedOut | loadingAccount → ready | error.
 */
export function AuthProvider({
  auth,
  baseUrl,
  children,
}: {
  auth: Auth;
  baseUrl: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<AuthState>({
    status: 'initializing',
    user: null,
    me: null,
    error: null,
  });
  const userRef = useRef<User | null>(null);

  const getToken = useCallback(
    async (forceRefresh = false) => {
      const user = userRef.current ?? auth.currentUser;
      return user ? user.getIdToken(forceRefresh) : null;
    },
    [auth],
  );

  const api = useMemo(
    () => new ApiClient({ baseUrl, getToken, onUnauthorized: () => void firebaseSignOut(auth) }),
    [auth, baseUrl, getToken],
  );

  const loadMe = useCallback(async (): Promise<Me | null> => {
    if (!userRef.current) return null;
    setState((s) => ({
      ...s,
      status: s.status === 'ready' ? 'ready' : 'loadingAccount',
      error: null,
    }));
    try {
      const me = await api.get<Me>('/auth/me');
      setState((s) => ({ ...s, status: 'ready', me, error: null }));
      return me;
    } catch (error) {
      setState((s) => ({ ...s, status: 'error', error }));
      return null;
    }
  }, [api]);

  useEffect(
    () =>
      onIdTokenChanged(auth, (user) => {
        const changedUser = user?.uid !== userRef.current?.uid;
        userRef.current = user;
        if (!user) {
          setState({ status: 'signedOut', user: null, me: null, error: null });
        } else if (changedUser) {
          setState({ status: 'loadingAccount', user, me: null, error: null });
          void loadMe();
        }
      }),
    [auth, loadMe],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      api,
      getToken,
      refreshMe: loadMe,
      async signIn(email, password) {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      },
      async signUp(email, password) {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      },
      async signOut() {
        await firebaseSignOut(auth);
      },
    }),
    [state, api, getToken, loadMe, auth],
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
