/**
 * Provision a SERVE admin (the only way admins are created).
 *
 *   npm run admin:create --workspace backend -- --email admin@uni.edu --name "Ada Admin"
 *
 * Development/test (Auth Emulator): if the Firebase user does not exist it is
 * created with the password in ADMIN_BOOTSTRAP_PASSWORD.
 *
 * Production: the Firebase user must already exist (create it in the Firebase
 * console); this script only links it. Requires --confirm-production. Passwords
 * are never accepted on the command line.
 */
import { parseArgs } from 'node:util';
import { loadEnv } from '../src/config/env.js';
import { createFirebaseAuth, closeFirebase } from '../src/lib/firebase.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { bootstrapAdmin } from '../src/modules/auth/admin-bootstrap.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    'confirm-production': { type: 'boolean', default: false },
  },
});

if (!values.email || !values.name) {
  console.error('Usage: admin:create -- --email <email> --name "<name>" [--confirm-production]');
  process.exit(1);
}

const env = loadEnv();
const isProduction = env.NODE_ENV === 'production';
if (isProduction && !values['confirm-production']) {
  console.error('Refusing to modify production without --confirm-production.');
  process.exit(1);
}

const password = isProduction ? undefined : process.env.ADMIN_BOOTSTRAP_PASSWORD;
const prisma = createPrismaClient(env.DATABASE_URL);
try {
  const result = await bootstrapAdmin(
    { auth: createFirebaseAuth(env), prisma },
    { email: values.email, name: values.name, password, allowCreateFirebaseUser: !isProduction },
  );
  console.error(
    `Admin ready: ${values.email} (admin id ${result.adminId})` +
      (result.createdFirebaseUser
        ? ' — Firebase user created.'
        : ' — linked existing Firebase user.'),
  );
} catch (err) {
  console.error(`Admin bootstrap failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  await closeFirebase();
}
