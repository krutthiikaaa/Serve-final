import type { PrismaClient } from '../../lib/prisma.js';
import type { StaffStatus } from '../../generated/prisma/client.js';
import { ConflictError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { areaCanteenSelect, defaultCanteenOf } from '../canteens/service-areas.js';

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
  /** Lower-cased, verified @srmap.edu.in address. */
  email: string;
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
 * 2. Otherwise, first sign-in of an EXISTING account: exactly one unlinked
 *    account with the same (verified, exact) email is linked now. This is how
 *    accounts from before Better Auth, and admins provisioned by email
 *    (scripts/create-admin.ts), are claimed. Roles, approval status, canteen
 *    assignments and history stay exactly as they were.
 *    Refused, never guessed, when the email matches more than one account or
 *    an account already linked to a different identity (409, needs an admin).
 */
export async function resolvePrincipal(
  prisma: PrismaClient,
  identity: SignInIdentity,
): Promise<Principal | null> {
  const linked = await findLinked(prisma, identity.uid);
  if (linked) return linked;
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
  const [admins, staff, students] = await Promise.all([
    prisma.admin.findMany({ where: { email }, select: { id: true, authUserId: true } }),
    prisma.staff.findMany({ where: { email }, select: { id: true, authUserId: true } }),
    prisma.student.findMany({ where: { email }, select: { id: true, authUserId: true } }),
  ]);
  const matches = [
    ...admins.map((row) => ({ table: 'admin' as const, ...row })),
    ...staff.map((row) => ({ table: 'staff' as const, ...row })),
    ...students.map((row) => ({ table: 'student' as const, ...row })),
  ];
  if (matches.length === 0) return null;
  // A concurrent request of this same identity may have just linked it.
  if (matches.some((match) => match.authUserId === uid)) return findLinked(prisma, uid);
  if (matches.length > 1 || matches[0]!.authUserId !== null) accountConflict();
  const match = matches[0]!;
  // Conditional update: only an unlinked row is claimed (a concurrent claim
  // loses cleanly); the database trigger guarantees one account per identity.
  const where = { id: match.id, authUserId: null };
  try {
    const updated =
      match.table === 'admin'
        ? await prisma.admin.updateMany({ where, data: { authUserId: uid } })
        : match.table === 'staff'
          ? await prisma.staff.updateMany({ where, data: { authUserId: uid } })
          : await prisma.student.updateMany({ where, data: { authUserId: uid } });
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
