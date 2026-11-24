import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { normalizeEmail } from './srm-email.js';
import { isAdminEmail, isPasswordIdentityEmail, passwordSchema } from './sign-in-method.js';

/**
 * Password identities for staff and admins (email + password sign-in).
 *
 * Better Auth stores a password as a "credential" AuthAccount whose
 * accountId is the user's id, hashed with its scrypt implementation (random
 * salt per password). SERVE creates these rows itself — Better Auth's public
 * sign-up is disabled — so an identity is always created together with, or
 * linked to, its Staff or Admin account. Addresses are never marked verified:
 * SERVE sends no verification email.
 */
type Tx = Prisma.TransactionClient;

export const CREDENTIAL_PROVIDER_ID = 'credential';

/**
 * Validates a new password against the policy and hashes it the way Better
 * Auth verifies it at sign-in. Throws a ZodError (422) when it is too short
 * or too long. Hash outside transactions: scrypt is deliberately slow.
 */
export async function hashNewPassword(password: string): Promise<string> {
  return hashPassword(passwordSchema.parse(password));
}

/** A new sign-in identity with no sign-in method yet (emailVerified=false). */
export async function createIdentity(
  tx: Tx,
  input: { email: string; name: string },
): Promise<string> {
  const id = randomUUID();
  await tx.authUser.create({
    data: { id, email: input.email, name: input.name, emailVerified: false },
  });
  return id;
}

/**
 * Sets (or replaces) the password of an identity and ends every session it
 * has, so an old Google session or a session opened with the previous
 * password cannot be used again.
 */
export async function setIdentityPassword(
  tx: Tx,
  authUserId: string,
  passwordHash: string,
): Promise<void> {
  await tx.authAccount.upsert({
    where: {
      providerId_accountId: { providerId: CREDENTIAL_PROVIDER_ID, accountId: authUserId },
    },
    update: { password: passwordHash },
    create: {
      id: randomUUID(),
      userId: authUserId,
      accountId: authUserId,
      providerId: CREDENTIAL_PROVIDER_ID,
      password: passwordHash,
    },
  });
  await tx.authSession.deleteMany({ where: { userId: authUserId } });
}

export class PasswordAccountError extends Error {
  override name = 'PasswordAccountError';
}

/**
 * Operator tool (scripts/set-password.ts, scripts/create-admin.ts): give an
 * EXISTING staff or admin account a password, or reset it.
 *
 * Keeps the account exactly as it is — id, role, approval status, canteen,
 * capabilities and history. An account already linked to a sign-in identity
 * (e.g. its old Google identity) keeps that identity and gains a password;
 * an unlinked one is linked to the identity with its address, or a new one.
 * All of the identity's sessions end.
 */
export async function setAccountPassword(
  prisma: PrismaClient,
  input: { role: 'STAFF' | 'ADMIN'; email: string; passwordHash: string },
): Promise<{ accountId: string; authUserId: string; createdIdentity: boolean }> {
  const email = normalizeEmail(input.email) ?? '';
  const label = input.role === 'ADMIN' ? 'admin' : 'staff';
  if (!isPasswordIdentityEmail(email)) throw new PasswordAccountError('Not a valid email address.');
  if (input.role === 'ADMIN' && !isAdminEmail(email)) {
    throw new PasswordAccountError('Admins must use an @srmap.edu.in address.');
  }
  return prisma.$transaction(async (tx) => {
    const select = { id: true, name: true, authUserId: true } as const;
    const account =
      input.role === 'ADMIN'
        ? await tx.admin.findUnique({ where: { email }, select })
        : await tx.staff.findUnique({ where: { email }, select });
    if (!account) throw new PasswordAccountError(`No ${label} account uses ${email}.`);

    let authUserId = account.authUserId;
    let createdIdentity = false;
    if (!authUserId) {
      const identity = await tx.authUser.findUnique({
        where: { email },
        select: {
          id: true,
          student: { select: { id: true } },
          staff: { select: { id: true } },
          admin: { select: { id: true } },
        },
      });
      if (identity && (identity.student || identity.staff || identity.admin)) {
        throw new PasswordAccountError(`${email} already belongs to another SERVE account.`);
      }
      authUserId = identity?.id ?? (await createIdentity(tx, { email, name: account.name }));
      createdIdentity = !identity;
      const where = { id: account.id, authUserId: null };
      const linked =
        input.role === 'ADMIN'
          ? await tx.admin.updateMany({ where, data: { authUserId } })
          : await tx.staff.updateMany({ where, data: { authUserId } });
      if (linked.count !== 1) {
        throw new PasswordAccountError('The account changed in the meantime; try again.');
      }
    }
    await setIdentityPassword(tx, authUserId, input.passwordHash);
    return { accountId: account.id, authUserId, createdIdentity };
  });
}
