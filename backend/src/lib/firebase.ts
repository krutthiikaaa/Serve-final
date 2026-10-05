import { cert, deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import type { Env } from '../config/env.js';
import { ServiceUnavailableError, UnauthorizedError } from './errors.js';

/** Identity proven by Firebase. Roles are NOT part of this — PostgreSQL decides those. */
export interface VerifiedIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  /** When the ID token stops being valid. */
  expiresAt: Date;
}

export interface IdentityVerifier {
  verifyIdToken(idToken: string): Promise<VerifiedIdentity>;
}

const APP_NAME = 'serve-backend';

/**
 * Initialise (or reuse) the Firebase Admin app.
 *
 * - Emulator mode (development/test): FIREBASE_AUTH_EMULATOR_HOST is exported
 *   to process.env, which is how the Admin SDK discovers the emulator. No
 *   credentials are needed.
 * - Real project: service-account credentials from the environment. Switching
 *   is configuration-only.
 */
export function createFirebaseAuth(
  env: Pick<
    Env,
    | 'FIREBASE_PROJECT_ID'
    | 'FIREBASE_CLIENT_EMAIL'
    | 'FIREBASE_PRIVATE_KEY'
    | 'FIREBASE_AUTH_EMULATOR_HOST'
  >,
): Auth {
  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) return getAuth(existing);

  let app: App;
  if (env.FIREBASE_AUTH_EMULATOR_HOST) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = env.FIREBASE_AUTH_EMULATOR_HOST;
    app = initializeApp({ projectId: env.FIREBASE_PROJECT_ID }, APP_NAME);
  } else {
    if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
      throw new Error('Firebase service-account credentials are not configured');
    }
    app = initializeApp(
      {
        projectId: env.FIREBASE_PROJECT_ID,
        credential: cert({
          projectId: env.FIREBASE_PROJECT_ID,
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
          privateKey: env.FIREBASE_PRIVATE_KEY,
        }),
      },
      APP_NAME,
    );
  }
  return getAuth(app);
}

export async function closeFirebase(): Promise<void> {
  await Promise.all(getApps().map((app) => deleteApp(app)));
}

/** Firebase error codes that mean "this token must not be accepted". */
const TOKEN_ERRORS: Record<string, { code: string; message: string }> = {
  'auth/id-token-expired': {
    code: 'AUTH_TOKEN_EXPIRED',
    message: 'Your session has expired. Please sign in again.',
  },
  'auth/id-token-revoked': {
    code: 'AUTH_TOKEN_REVOKED',
    message: 'Your session was revoked. Please sign in again.',
  },
  'auth/user-disabled': { code: 'AUTH_USER_DISABLED', message: 'This account has been disabled.' },
  'auth/user-not-found': { code: 'AUTH_TOKEN_INVALID', message: 'Invalid authentication token.' },
  'auth/argument-error': { code: 'AUTH_TOKEN_INVALID', message: 'Invalid authentication token.' },
  'auth/invalid-id-token': { code: 'AUTH_TOKEN_INVALID', message: 'Invalid authentication token.' },
};

/**
 * Verifies Firebase ID tokens with revocation checking. Token problems map to
 * 401; infrastructure problems (Firebase unreachable) map to 503 so clients
 * are not logged out because of an outage.
 */
export class FirebaseIdentityVerifier implements IdentityVerifier {
  constructor(private readonly auth: Auth) {}

  async verifyIdToken(idToken: string): Promise<VerifiedIdentity> {
    try {
      const decoded = await this.auth.verifyIdToken(idToken, true);
      return {
        uid: decoded.uid,
        email: decoded.email ? decoded.email.toLowerCase() : null,
        emailVerified: decoded.email_verified === true,
        expiresAt: new Date(decoded.exp * 1000),
      };
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (typeof code === 'string') {
        const mapped = TOKEN_ERRORS[code];
        if (mapped) throw new UnauthorizedError(mapped.message, mapped.code);
        if (code.startsWith('auth/') && !code.includes('internal')) {
          throw new UnauthorizedError('Invalid authentication token.', 'AUTH_TOKEN_INVALID');
        }
      }
      throw new ServiceUnavailableError(
        'Authentication service is temporarily unavailable.',
        'AUTH_UNAVAILABLE',
      );
    }
  }
}
