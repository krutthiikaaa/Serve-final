import type { IncomingHttpHeaders } from 'node:http';
import { fromNodeHeaders } from 'better-auth/node';
import type { ServeAuth } from './auth.js';
import { ServiceUnavailableError } from './errors.js';
import { normalizeEmail, srmIdentityRejection } from '../modules/auth/srm-email.js';

/**
 * Identity proven by a Better Auth session (Google, verified @srmap.edu.in).
 * Roles are NOT part of this: PostgreSQL decides those (principal.ts).
 */
export interface VerifiedIdentity {
  /** Better Auth user id (AuthUser.id); role rows reference it as authUserId. */
  uid: string;
  /** Lower-cased, Google-verified @srmap.edu.in address. */
  email: string;
  emailVerified: true;
  name: string;
  sessionId: string;
  /** When the session stops being valid. */
  expiresAt: Date;
}

export interface SessionVerifier {
  /**
   * The identity of a request (session cookie, or `Authorization: Bearer
   * <session token>`), or null when there is no valid session.
   */
  verify(headers: Headers | IncomingHttpHeaders): Promise<VerifiedIdentity | null>;
}

export function createSessionVerifier(auth: ServeAuth): SessionVerifier {
  return {
    async verify(headers) {
      let result: Awaited<ReturnType<ServeAuth['api']['getSession']>>;
      try {
        result = await auth.api.getSession({
          headers: headers instanceof Headers ? headers : fromNodeHeaders(headers),
          // Always read the database: a signed-out or revoked session ends at once.
          query: { disableCookieCache: true },
        });
      } catch {
        throw new ServiceUnavailableError(
          'Authentication service is temporarily unavailable.',
          'AUTH_UNAVAILABLE',
        );
      }
      if (!result) return null;
      const { user, session } = result;
      // Sessions are only ever created for qualifying identities; refuse
      // anything else rather than trust it (defence in depth).
      if (srmIdentityRejection({ email: user.email, emailVerified: user.emailVerified }))
        return null;
      return {
        uid: user.id,
        email: normalizeEmail(user.email) ?? user.email,
        emailVerified: true,
        name: user.name,
        sessionId: session.id,
        expiresAt: new Date(session.expiresAt),
      };
    },
  };
}
