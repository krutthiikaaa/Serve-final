import type { PrismaClient } from '../../lib/prisma.js';
import type { StaffStatus } from '../../generated/prisma/client.js';

/**
 * The authenticated caller as known to PostgreSQL. Built only from the
 * database — never from client-supplied roles, ids or canteen assignments.
 */
export interface StudentPrincipal {
  role: 'STUDENT';
  id: string;
  firebaseUid: string;
  email: string;
  name: string;
  isActive: boolean;
  hostelId: string;
  defaultCanteenId: string;
}

export interface StaffPrincipal {
  role: 'STAFF';
  id: string;
  firebaseUid: string;
  email: string;
  name: string;
  status: StaffStatus;
  isActive: boolean;
  canteenId: string | null;
}

export interface AdminPrincipal {
  role: 'ADMIN';
  id: string;
  firebaseUid: string;
  email: string;
  name: string;
  isActive: boolean;
}

export type Principal = StudentPrincipal | StaffPrincipal | AdminPrincipal;
export type Role = Principal['role'];

/** Look up which (single) account a Firebase UID belongs to. */
export async function resolvePrincipal(
  prisma: PrismaClient,
  firebaseUid: string,
): Promise<Principal | null> {
  const [admin, staff, student] = await Promise.all([
    prisma.admin.findUnique({ where: { firebaseUid } }),
    prisma.staff.findUnique({ where: { firebaseUid } }),
    prisma.student.findUnique({
      where: { firebaseUid },
      include: { hostel: { select: { canteenId: true } } },
    }),
  ]);

  if (admin) {
    return {
      role: 'ADMIN',
      id: admin.id,
      firebaseUid,
      email: admin.email,
      name: admin.name,
      isActive: admin.isActive,
    };
  }
  if (staff) {
    return {
      role: 'STAFF',
      id: staff.id,
      firebaseUid,
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
      firebaseUid,
      email: student.email,
      name: student.name,
      isActive: student.isActive,
      hostelId: student.hostelId,
      defaultCanteenId: student.hostel.canteenId,
    };
  }
  return null;
}

/** True when the UID already belongs to any account type. */
export async function isFirebaseUidRegistered(
  prisma: PrismaClient,
  firebaseUid: string,
): Promise<boolean> {
  const counts = await Promise.all([
    prisma.admin.count({ where: { firebaseUid } }),
    prisma.staff.count({ where: { firebaseUid } }),
    prisma.student.count({ where: { firebaseUid } }),
  ]);
  return counts.some((count) => count > 0);
}
