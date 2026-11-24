import type { PrismaClient } from '../../lib/prisma.js';
import { isSrmEmail, normalizeEmail } from './srm-email.js';

export interface BootstrapAdminInput {
  email: string;
  name: string;
}

/**
 * Controlled admin provisioning — the ONLY way an Admin row is created.
 * There is no public admin registration endpoint, and no Google sign-in ever
 * creates an admin on its own.
 *
 * Creates (or re-activates) an Admin row for an @srmap.edu.in address.
 * Admins sign in with email + password: the row has no way to sign in until
 * a password is set (password-accounts.ts setAccountPassword, which
 * scripts/create-admin.ts does right after this). Google sign-in is refused
 * for admin addresses. Refuses an address that already belongs to a student
 * or staff account.
 */
export async function bootstrapAdmin(
  deps: { prisma: PrismaClient },
  input: BootstrapAdminInput,
): Promise<{ adminId: string; linked: boolean; created: boolean }> {
  const email = normalizeEmail(input.email) ?? '';
  if (!isSrmEmail(email)) {
    throw new Error('Admins must use an @srmap.edu.in Google account.');
  }
  const [student, staff] = await Promise.all([
    deps.prisma.student.findUnique({ where: { email } }),
    deps.prisma.staff.findUnique({ where: { email } }),
  ]);
  if (student || staff) {
    throw new Error(`${email} is already registered as a ${student ? 'student' : 'staff member'}.`);
  }
  const existing = await deps.prisma.admin.findUnique({ where: { email } });
  const admin = await deps.prisma.admin.upsert({
    where: { email },
    update: { isActive: true, name: input.name },
    create: { email, name: input.name },
  });
  return { adminId: admin.id, linked: admin.authUserId !== null, created: !existing };
}
