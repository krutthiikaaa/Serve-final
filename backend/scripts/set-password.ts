/**
 * Set or reset the password of an EXISTING staff or admin account.
 *
 *   npm run account:set-password --workspace backend -- --role staff --email someone@gmail.com
 *   npm run account:set-password --workspace backend -- --role admin --email someone@example.com
 *
 * Staff and admins sign in with email + password (students use Google). Use
 * this to move an existing account (created before passwords existed) to
 * password sign-in, or when someone forgets their password: SERVE sends no
 * email, so there is no self-service reset.
 *
 * The password is asked for twice without being shown (or read from the
 * first line of stdin); it is never a command-line argument. The account
 * keeps its id, role, approval status, canteen and capabilities. Every
 * session of that account ends. Production requires --confirm-production.
 */
import { parseArgs } from 'node:util';
import { ZodError } from 'zod';
import { loadEnv } from '../src/config/env.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { hashNewPassword, setAccountPassword } from '../src/modules/auth/password-accounts.js';
import { readNewPassword } from './read-password.js';

const { values } = parseArgs({
  options: {
    role: { type: 'string' },
    email: { type: 'string' },
    'confirm-production': { type: 'boolean', default: false },
  },
});

const role = values.role === 'staff' ? 'STAFF' : values.role === 'admin' ? 'ADMIN' : null;
if (!role || !values.email) {
  console.error(
    'Usage: account:set-password -- --role staff|admin --email <address> [--confirm-production]',
  );
  process.exit(1);
}

const env = loadEnv();
if (env.NODE_ENV === 'production' && !values['confirm-production']) {
  console.error('Refusing to modify production without --confirm-production.');
  process.exit(1);
}

let passwordHash: string;
try {
  passwordHash = await hashNewPassword(await readNewPassword());
} catch (err) {
  console.error(
    err instanceof ZodError
      ? `Password rejected: ${err.issues.map((issue) => issue.message).join('; ')}`
      : (err as Error).message,
  );
  process.exit(1);
}

const prisma = createPrismaClient(env.DATABASE_URL);
try {
  const result = await setAccountPassword(prisma, { role, email: values.email, passwordHash });
  console.error(
    `Password set for ${values.email} (${role.toLowerCase()} ${result.accountId}). ` +
      'All of its sessions have ended; sign in with the new password.',
  );
} catch (err) {
  console.error(`Could not set the password: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
