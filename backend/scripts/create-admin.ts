/**
 * Provision a SERVE admin (the only way admins are created).
 *
 *   npm run admin:create --workspace backend -- --email someone@srmap.edu.in --name "Ada Admin"
 *
 * The address must be an @srmap.edu.in Google account. The admin is linked to
 * that Google identity the first time its owner signs in with Google; until
 * then nobody holds admin rights through it. Production requires
 * --confirm-production. No password is involved.
 */
import { parseArgs } from 'node:util';
import { loadEnv } from '../src/config/env.js';
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
  console.error(
    'Usage: admin:create -- --email <name>@srmap.edu.in --name "<name>" [--confirm-production]',
  );
  process.exit(1);
}

const env = loadEnv();
if (env.NODE_ENV === 'production' && !values['confirm-production']) {
  console.error('Refusing to modify production without --confirm-production.');
  process.exit(1);
}

const prisma = createPrismaClient(env.DATABASE_URL);
try {
  const result = await bootstrapAdmin({ prisma }, { email: values.email, name: values.name });
  console.error(
    `Admin ready: ${values.email} (admin id ${result.adminId}) — ` +
      (result.linked
        ? 'already linked to its Google sign-in.'
        : 'becomes active at its first Google sign-in with this address.'),
  );
} catch (err) {
  console.error(`Admin bootstrap failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
