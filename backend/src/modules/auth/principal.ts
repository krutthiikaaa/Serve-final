import type { PrismaClient } from '../../lib/prisma.js';
import type { StaffStatus } from '../../generated/prisma/client.js';
import { ConflictError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { areaCanteenSelect, defaultCanteenOf } from '../canteens/service-areas.js';
import type { AuthMethod } from './sign-in-method.js';

/**
 * The authenticated caller as known to PostgreSQL. Built only from the
 * database — never from client-supplied roles, ids or canteen assignments.
 */
export interface StudentPrincipal {
  role: 'STUDENT';
  id: string;
  /** Better Auth identity (AuthUser.id) this account is linked to. */
  authUserId: string;
  email: string;
  name: string;
  isActive: boolean;
  hostelId: string;
  serviceAreaId: string;
  /** Resolved from the hostel's service area at request time; null if it has no canteen. */
  defaultCanteenId: string | null;
}

export interface StaffPrincipal {
  role: 'STAFF';
  id: string;
  /** Better Auth identity (AuthUser.id) this account is linked to. */
  authUserId: string;
  email: string;
  name: string;
  status: StaffStatus;
  isActive: boolean;
  canteenId: string | null;
}

export interface AdminPrincipal {
  role: 'ADMIN';
  id: string;
  /** Better Auth identity (AuthUser.id) this account is linked to. */
  authUserId: string;
  email: string;
  name: string;
  isActive: boolean;
}

export type Principal = StudentPrincipal | StaffPrincipal | AdminPrincipal;
export type Role = Principal['role'];

/** The sign-in identity a request carries (see lib/session.ts). */
export interface SignInIdentity {
  /** AuthUser.id */
  uid: string;
  /** Lower-cased address (Google sessions: verified @srmap.edu.in). */
  email: string;
  /** How the session was created; null/absent = Google (pre-existing sessions). */
  authMethod?: AuthMethod | null;
}

const studentInclude = {
  hostel: {
    select: {
      serviceAreaId: true,
      serviceArea: { select: { canteens: { select: areaCanteenSelect } } },
    },
  },
} as const;

/**
 * The account (Student, Staff or Admin) of a signed-in identity, or null when
 * it has none yet ("complete your registration").
 *
 * 1. The account already linked to this identity (authUserId).
 * 2. Otherwise, a Google identity's first sign-in may claim an EXISTING
 *    student account: exactly one unlinked Student row with the same
 *    (Google-verified, exact) email is linked now, keeping its history.
 *    Refused, never guessed, when the email matches more than one account or
 *    an account already linked to a different identity (409, needs an admin).
 *    Staff and admin accounts are never claimed by email: they sign in with a
 *    password, and their identity is linked when the password is created
 *    (staff sign-up, scripts/create-admin.ts, scripts/set-password.ts).
 *    Password identities never claim anything (they are always created linked).
 */
export async function resolvePrincipal(
  prisma: PrismaClient,
  identity: SignInIdentity,
): Promise<Principal | null> {
  const linked = await findLinked(prisma, identity.uid);
  if (linked) return linked;
  if (identity.authMethod === 'password') return null;
  return claimByEmail(prisma, identity);
}

async function findLinked(prisma: PrismaClient, authUserId: string): Promise<Principal | null> {
  const [admin, staff, student] = await Promise.all([
    prisma.admin.findUnique({ where: { authUserId } }),
    prisma.staff.findUnique({ where: { authUserId } }),
    prisma.student.findUnique({ where: { authUserId }, include: studentInclude }),
  ]);
  if (admin) {
    return {
      role: 'ADMIN',
      id: admin.id,
      authUserId,
      email: admin.email,
      name: admin.name,
      isActive: admin.isActive,
    };
  }
  if (staff) {
    return {
      role: 'STAFF',
      id: staff.id,
      authUserId,
      email: staff.email,
      name: staff.name,
      status: staff.status,
      isActive: staff.status !== 'DEACTIVATED',
      canteenId: staff.canteenId,
    };
  }
  if (student) {
    return {
      role: 'STUDENT',
      id: student.id,
      authUserId,
      email: student.email,
      name: student.name,
      isActive: student.isActive,
      hostelId: student.hostelId,
      serviceAreaId: student.hostel.serviceAreaId,
      defaultCanteenId: defaultCanteenOf(student.hostel.serviceArea.canteens)?.id ?? null,
    };
  }
  return null;
}

function accountConflict(): never {
  throw new ConflictError(
    'Your SRM email matches more than one SERVE account, or an account already linked to another sign-in. Ask an administrator to resolve it.',
    'ACCOUNT_LINK_CONFLICT',
  );
}

async function claimByEmail(
  prisma: PrismaClient,
  identity: SignInIdentity,
): Promise<Principal | null> {
  const { email, uid } = identity;
  // Google identities claim student accounts only; a staff/admin address is
  // refused at session creation (lib/auth.ts) and never claimed here.
  const students = await prisma.student.findMany({
    where: { email },
    select: { id: true, authUserId: true },
  });
  if (students.length === 0) return null;
  // A concurrent request of this same identity may have just linked it.
  if (students.some((match) => match.authUserId === uid)) return findLinked(prisma, uid);
  if (students.length > 1 || students[0]!.authUserId !== null) accountConflict();
  const match = students[0]!;
  // Conditional update: only an unlinked row is claimed (a concurrent claim
  // loses cleanly); the database trigger guarantees one account per identity.
  try {
    const updated = await prisma.student.updateMany({
      where: { id: match.id, authUserId: null },
      data: { authUserId: uid },
    });
    if (updated.count !== 1) return findLinked(prisma, uid).then((p) => p ?? accountConflict());
  } catch (err) {
    if (isAuthUserTaken(err)) accountConflict();
    throw err;
  }
  return findLinked(prisma, uid);
}

/** The identity already belongs to another account (unique index or single-role trigger). */
export function isAuthUserTaken(err: unknown): boolean {
  return (
    isUniqueViolation(err, 'authUserId') || isUniqueViolation(err, 'AuthUser_single_role_account')
  );
}

/** True when the identity already has an account of any type. */
export async function isAuthUserRegistered(
  prisma: PrismaClient,
  authUserId: string,
): Promise<boolean> {
  const counts = await Promise.all([
    prisma.admin.count({ where: { authUserId } }),
    prisma.staff.count({ where: { authUserId } }),
    prisma.student.count({ where: { authUserId } }),
  ]);
  return counts.some((count) => count > 0);
}
