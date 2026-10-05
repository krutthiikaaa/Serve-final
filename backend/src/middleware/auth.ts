import type { Request, RequestHandler } from 'express';
import type { IdentityVerifier, VerifiedIdentity } from '../lib/firebase.js';
import type { PrismaClient } from '../lib/prisma.js';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import {
  resolvePrincipal,
  type AdminPrincipal,
  type Principal,
  type StaffPrincipal,
  type StudentPrincipal,
} from '../modules/auth/principal.js';

export interface AuthContext extends VerifiedIdentity {
  /** null when the Firebase user has not registered a SERVE account yet. */
  principal: Principal | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

/** An approved staff member with a guaranteed canteen assignment. */
export type ApprovedStaffPrincipal = StaffPrincipal & { status: 'APPROVED'; canteenId: string };

const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]+)$/;

export function bearerToken(header: string | undefined): string | null {
  const match = header ? BEARER.exec(header) : null;
  return match?.[1] ?? null;
}

/**
 * authenticateUser: verifies the Firebase ID token, then loads the caller's
 * account from PostgreSQL. Authorization decisions downstream use only this
 * database-backed context.
 */
export function createAuthenticate(deps: {
  verifier: IdentityVerifier;
  prisma: PrismaClient;
}): RequestHandler {
  return async (req, _res, next) => {
    const token = bearerToken(req.headers.authorization);
    if (!token) {
      throw new UnauthorizedError('Authentication required', 'AUTH_REQUIRED');
    }
    const identity = await deps.verifier.verifyIdToken(token);
    const principal = await resolvePrincipal(deps.prisma, identity.uid);
    req.auth = { ...identity, principal };
    next();
  };
}

function authOf(req: Request): AuthContext {
  if (!req.auth) throw new UnauthorizedError('Authentication required', 'AUTH_REQUIRED');
  return req.auth;
}

function registeredPrincipal(req: Request): Principal {
  const { principal } = authOf(req);
  if (!principal) {
    throw new ForbiddenError('Complete your SERVE registration first.', 'ACCOUNT_NOT_REGISTERED');
  }
  return principal;
}

function wrongRole(): never {
  throw new ForbiddenError('You do not have permission to perform this action', 'FORBIDDEN_ROLE');
}

export function currentStudent(req: Request): StudentPrincipal {
  const principal = registeredPrincipal(req);
  if (principal.role !== 'STUDENT') wrongRole();
  if (!principal.isActive)
    throw new ForbiddenError('This account is disabled.', 'ACCOUNT_DISABLED');
  return principal;
}

export function currentStaff(req: Request): StaffPrincipal {
  const principal = registeredPrincipal(req);
  if (principal.role !== 'STAFF') wrongRole();
  if (principal.status === 'DEACTIVATED') {
    throw new ForbiddenError('This staff account has been deactivated.', 'STAFF_DEACTIVATED');
  }
  return principal;
}

export function currentApprovedStaff(req: Request): ApprovedStaffPrincipal {
  const staff = currentStaff(req);
  if (staff.status !== 'APPROVED' || !staff.canteenId) {
    throw new ForbiddenError(
      'Your staff account is awaiting admin approval.',
      'STAFF_NOT_APPROVED',
    );
  }
  return staff as ApprovedStaffPrincipal;
}

export function currentAdmin(req: Request): AdminPrincipal {
  const principal = registeredPrincipal(req);
  if (principal.role !== 'ADMIN') wrongRole();
  if (!principal.isActive)
    throw new ForbiddenError('This account is disabled.', 'ACCOUNT_DISABLED');
  return principal;
}

/** Any registered, active account. */
export function currentPrincipal(req: Request): Principal {
  const principal = registeredPrincipal(req);
  if (!principal.isActive)
    throw new ForbiddenError('This account is disabled.', 'ACCOUNT_DISABLED');
  return principal;
}

const guard =
  (check: (req: Request) => unknown): RequestHandler =>
  (req, _res, next) => {
    check(req);
    next();
  };

export const requireStudent = guard(currentStudent);
export const requireStaff = guard(currentStaff);
export const requireApprovedStaff = guard(currentApprovedStaff);
export const requireAdmin = guard(currentAdmin);
export const requireRegistered = guard(currentPrincipal);
