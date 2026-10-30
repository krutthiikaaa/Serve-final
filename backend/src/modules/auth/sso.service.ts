import { createHash, randomBytes } from 'node:crypto';
import type { Env } from '../../config/env.js';
import type { IdentityVerifier } from '../../lib/firebase.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { ForbiddenError, UnauthorizedError } from '../../lib/errors.js';
import { resolvePrincipal, type Principal } from './principal.js';

export type SsoAudience = 'STAFF' | 'ADMIN';

const LOCAL_STAFF = 'http://localhost:5173';
const LOCAL_ADMIN = 'http://localhost:5174';

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function generateCode(): string {
  return randomBytes(32).toString('base64url');
}

function dashboardBase(env: Env, audience: SsoAudience): string {
  const configured = audience === 'STAFF' ? env.STAFF_DASHBOARD_URL : env.ADMIN_PORTAL_URL;
  if (configured) return configured;
  return audience === 'STAFF' ? LOCAL_STAFF : LOCAL_ADMIN;
}

function callbackUrl(base: string, code: string): string {
  const url = new URL('sso/callback', `${base}/`);
  url.searchParams.set('code', code);
  return url.toString();
}

/**
 * Authorises a PostgreSQL principal for a dashboard. Roles, approval and
 * canteen assignment come only from the database.
 */
export function assertDashboardAccess(principal: Principal | null, audience: SsoAudience): void {
  if (!principal) {
    throw new ForbiddenError('Complete your SERVE registration first.', 'ACCOUNT_NOT_REGISTERED');
  }
  if (!principal.isActive) {
    throw new ForbiddenError(
      principal.role === 'STAFF'
        ? 'This staff account has been deactivated.'
        : 'This account is disabled.',
      principal.role === 'STAFF' ? 'STAFF_DEACTIVATED' : 'ACCOUNT_DISABLED',
    );
  }
  if (audience === 'STAFF') {
    if (principal.role !== 'STAFF') {
      throw new ForbiddenError('You do not have permission to perform this action', 'FORBIDDEN_ROLE');
    }
    if (principal.status !== 'APPROVED' || !principal.canteenId) {
      throw new ForbiddenError(
        'Your staff account is awaiting admin approval.',
        'STAFF_NOT_APPROVED',
      );
    }
    return;
  }
  if (principal.role !== 'ADMIN') {
    throw new ForbiddenError('You do not have permission to perform this action', 'FORBIDDEN_ROLE');
  }
}

export function createSsoService(deps: {
  prisma: PrismaClient;
  env: Env;
  verifier: IdentityVerifier;
}) {
  const { prisma, env, verifier } = deps;
  const ttlMs = env.SSO_CODE_TTL_SECONDS * 1000;

  return {
    async initiate(firebaseUid: string, principal: Principal | null, audience: SsoAudience) {
      assertDashboardAccess(principal, audience);
      const code = generateCode();
      const expiresAt = new Date(Date.now() + ttlMs);
      await prisma.ssoAuthorizationCode.create({
        data: {
          codeHash: hashCode(code),
          firebaseUid,
          audience,
          expiresAt,
        },
      });
      return {
        redirectUrl: callbackUrl(dashboardBase(env, audience), code),
        expiresAt: expiresAt.toISOString(),
      };
    },

    async exchange(code: string, audience: SsoAudience) {
      const codeHash = hashCode(code);
      const consumed = await prisma.ssoAuthorizationCode.updateMany({
        where: {
          codeHash,
          audience,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedError(
          'This sign-in link is invalid or has expired.',
          'SSO_CODE_INVALID',
        );
      }
      const row = await prisma.ssoAuthorizationCode.findUniqueOrThrow({ where: { codeHash } });
      const principal = await resolvePrincipal(prisma, row.firebaseUid);
      assertDashboardAccess(principal, audience);
      const customToken = await verifier.createCustomToken(row.firebaseUid);
      return { customToken };
    },
  };
}
