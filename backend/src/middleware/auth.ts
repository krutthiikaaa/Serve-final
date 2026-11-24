import type { Request, RequestHandler } from 'express';
import type { SessionVerifier, VerifiedIdentity } from '../lib/session.js';
import type { PrismaClient } from '../lib/prisma.js';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import {
  resolvePrincipal,
  type AdminPrincipal,
  type Principal,
  type StaffPrincipal,
  type StudentPrincipal,
} from '../modules/auth/principal.js';
import {
  SIGN_IN_METHOD_MESSAGE,
  isSignInMethodAllowed,
  requiredSignInMethod,
} from '../modules/auth/sign-in-method.js';

export interface AuthContext extends VerifiedIdentity {
  /** null when the signed-in identity has not registered a SERVE account yet. */
  principal: Principal | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    /** Assigned canteen this request is operating on (never a client-trusted id). */
    staffCanteenId?: string;
  }
}

/** An approved staff member with a guaranteed canteen assignment. */
export type ApprovedStaffPrincipal = StaffPrincipal & { status: 'APPROVED'; canteenId: string };

/**
 * The account a session may act as, or an error when the session's sign-in
 * method is not the one the account's role requires (a staff member or admin
 * signed in with Google, a student with a password, or a session from before
 * role-specific sign-in held by a staff member or admin). Such a session is
 * revoked at once, so it cannot be used again anywhere.
 */
export async function principalForSession(
  prisma: PrismaClient,
  identity: VerifiedIdentity,
): Promise<Principal | null> {
  const principal = await resolvePrincipal(prisma, identity);
  if (!isSignInMethodAllowed(identity.authMethod, principal?.role ?? null)) {
    await prisma.authSession.deleteMany({ where: { id: identity.sessionId } });
    throw new UnauthorizedError(
      SIGN_IN_METHOD_MESSAGE[requiredSignInMethod(principal?.role ?? null)],
      'SIGN_IN_METHOD_NOT_ALLOWED',
    );
  }
  return principal;
}

/**
 * authenticateUser: verifies the Better Auth session (HttpOnly cookie from the
 * web apps, or `Authorization: Bearer <session token>` from the native app),
 * then loads the caller's account from PostgreSQL and checks that the session
 * was created with the sign-in method the account's role requires.
 * Authorization decisions downstream use only this database-backed context.
 */
export function createAuthenticate(deps: {
  sessions: SessionVerifier;
  prisma: PrismaClient;
}): RequestHandler {
  return async (req, _res, next) => {
    const identity = await deps.sessions.verify(req.headers);
    if (!identity) {
      throw new UnauthorizedError('Authentication required', 'AUTH_REQUIRED');
    }
    const principal = await principalForSession(deps.prisma, identity);
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
