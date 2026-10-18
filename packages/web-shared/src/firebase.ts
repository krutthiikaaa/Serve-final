import { getApps, initializeApp } from '@firebase/app';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth,
} from '@firebase/auth';

/** Public Firebase web configuration (never secrets — Admin credentials live only in the backend). */
export interface FirebaseWebConfig {
  apiKey: string;
  projectId: string;
  authDomain?: string | undefined;
  /** Development only, e.g. http://127.0.0.1:9099 */
  emulatorUrl?: string | undefined;
}

let auth: Auth | undefined;

export function initFirebaseAuth(config: FirebaseWebConfig): Auth {
  if (auth) return auth;
  const app =
    getApps()[0] ??
    initializeApp({
      apiKey: config.apiKey,
      projectId: config.projectId,
      authDomain: config.authDomain ?? `${config.projectId}.firebaseapp.com`,
    });
  // getAuth() minus the popup/redirect resolver: SERVE signs in with email and
  // password only, so no Google sign-in scripts or iframes are loaded (the
  // single-domain CSP allows scripts from this origin only).
  auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
  });
  if (config.emulatorUrl) connectAuthEmulator(auth, config.emulatorUrl, { disableWarnings: true });
  return auth;
}

/** Friendly messages for Firebase Auth error codes. */
export function firebaseErrorMessage(err: unknown): string {
  const code = (err as { code?: string }).code ?? '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(code)) {
    return 'Incorrect email or password.';
  }
  if (code.includes('email-already-in-use'))
    return 'An account with this email already exists. Sign in instead.';
  if (code.includes('weak-password')) return 'Choose a password with at least 6 characters.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Please wait and try again.';
  if (code.includes('network-request-failed'))
    return 'Unable to reach the sign-in service. Check your connection.';
  if (code.includes('user-disabled')) return 'This account has been disabled.';
  return 'Sign-in failed. Please try again.';
}
