import type { Auth } from 'firebase-admin/auth';
import type { PrismaClient } from '../../lib/prisma.js';

export interface BootstrapAdminInput {
  email: string;
  name: string;
  /** Only used to create the Firebase user when it does not exist (non-production). */
  password?: string | undefined;
  allowCreateFirebaseUser: boolean;
}

/**
 * Controlled admin provisioning — the ONLY way an Admin row is created.
 * There is no public admin registration endpoint.
 *
 * Links an existing Firebase user (or creates one where allowed) to an Admin
 * record. Refuses UIDs that already belong to a student or staff account.
 */
export async function bootstrapAdmin(
  deps: { auth: Auth; prisma: PrismaClient },
  input: BootstrapAdminInput,
): Promise<{ adminId: string; firebaseUid: string; createdFirebaseUser: boolean }> {
  const email = input.email.trim().toLowerCase();
  let createdFirebaseUser = false;

  let uid: string;
  try {
    uid = (await deps.auth.getUserByEmail(email)).uid;
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/user-not-found') throw err;
    if (!input.allowCreateFirebaseUser || !input.password) {
      throw new Error(
        `No Firebase user exists for ${email}. Create it in Firebase Authentication first.`,
        { cause: err },
      );
    }
    uid = (await deps.auth.createUser({ email, password: input.password, displayName: input.name }))
      .uid;
    createdFirebaseUser = true;
  }

  const [student, staff] = await Promise.all([
    deps.prisma.student.findUnique({ where: { firebaseUid: uid } }),
    deps.prisma.staff.findUnique({ where: { firebaseUid: uid } }),
  ]);
  if (student || staff) {
    throw new Error(`${email} is already registered as a ${student ? 'student' : 'staff member'}.`);
  }

  const admin = await deps.prisma.admin.upsert({
    where: { firebaseUid: uid },
    update: { isActive: true, name: input.name, email },
    create: { firebaseUid: uid, email, name: input.name },
  });
  return { adminId: admin.id, firebaseUid: uid, createdFirebaseUser };
}
