/**
 * Provision a SERVE admin (the only way admins are created).
 *
 *   npm run admin:create --workspace backend -- --email someone@srmap.edu.in --name "Ada Admin"
 *
 * Admins sign in with email + password; the address must be @srmap.edu.in.
 * The password is asked for twice without being shown (or read from the
 * first line of stdin); it is never a command-line argument. Running it again
 * for an existing admin re-activates the account and replaces its password
 * (every session ends). Production requires --confirm-production.
 */
import { parseArgs } from 'node:util';
import { ZodError } from 'zod';
import { loadEnv } from '../src/config/env.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { bootstrapAdmin } from '../src/modules/auth/admin-bootstrap.js';
import { hashNewPassword, setAccountPassword } from '../src/modules/auth/password-accounts.js';
import { isSrmEmail } from '../src/modules/auth/srm-email.js';
import { readNewPassword } from './read-password.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    'confirm-production': { type: 'boolean', default: false },
  },
});

if (!values.email || !values.name) {
  console.error(
    'Usage: admin:create -- --email <name>@srmap.edu.in --name "<name>" [--confirm-production]',
  );
  process.exit(1);
}
if (!isSrmEmail(values.email)) {
  console.error('Admins must use an @srmap.edu.in address.');
  process.exit(1);
}

const env = loadEnv();
if (env.NODE_ENV === 'production' && !values['confirm-production']) {
  console.error('Refusing to modify production without --confirm-production.');
  process.exit(1);
}

let passwordHash: string;
try {
  passwordHash = await hashNewPassword(await readNewPassword('Admin password'));
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
  const result = await bootstrapAdmin({ prisma }, { email: values.email, name: values.name });
  await setAccountPassword(prisma, { role: 'ADMIN', email: values.email, passwordHash });
  console.error(
    `Admin ${result.created ? 'created' : 'updated'}: ${values.email} (admin id ${result.adminId}). ` +
      'Sign in to the admin portal with this email and password.',
  );
} catch (err) {
  console.error(`Admin bootstrap failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
