import { pathToFileURL } from 'node:url';
import type { Auth } from 'firebase-admin/auth';
import type { Logger } from 'pino';
import { loadEnv, type Env } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { seedDatabase } from '../db/seed.js';
import { closeFirebase, createFirebaseAuth } from '../lib/firebase.js';
import { createPrismaClient, type PrismaClient } from '../lib/prisma.js';
import { bootstrapAdmin } from '../modules/auth/admin-bootstrap.js';

export interface ReleaseResult {
  catalogue: 'seeded' | 'present' | 'skipped';
  admin: 'linked' | 'not-configured' | 'failed';
}

type ReleaseEnv = Pick<
  Env,
  'NODE_ENV' | 'DEMO_MODE' | 'DATABASE_URL' | 'ADMIN_BOOTSTRAP_EMAIL' | 'ADMIN_BOOTSTRAP_NAME'
>;

/** Database name and host for the log; never the credentials. */
function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    return `"${decodeURIComponent(parsed.pathname.slice(1))}" on ${parsed.hostname}`;
  } catch {
    return '(unreadable DATABASE_URL)';
  }
}

/**
 * Release tasks, run by scripts/start-production.sh after
 * `prisma migrate deploy` and before the server starts. They exist for hosts
 * without a separate release step (Render's free plan has no pre-deploy
 * command and no shell). Nothing here resets, deletes or changes existing rows.
 *
 * 1. Catalogue: on an empty database (no canteens yet), the idempotent
 *    catalogue seed (hostels, canteens, menus), under the same rule as
 *    `npm run db:seed`: in production only with DEMO_MODE=true.
 * 2. First admin: with ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_NAME set,
 *    links that existing Firebase user as an admin, exactly like
 *    `npm run admin:create -- --confirm-production` (it never creates Firebase
 *    users). A failure is logged and does not stop the server.
 */
export async function runRelease(deps: {
  env: ReleaseEnv;
  logger: Logger;
  prisma: PrismaClient;
  auth: () => Auth;
}): Promise<ReleaseResult> {
  const { env, logger, prisma } = deps;
  logger.info({ database: describeDatabase(env.DATABASE_URL) }, 'Release tasks starting');

  let catalogue: ReleaseResult['catalogue'] = 'present';
  if ((await prisma.canteen.count()) === 0) {
    if (env.NODE_ENV === 'production' && !env.DEMO_MODE) {
      catalogue = 'skipped';
      logger.warn(
        'The database has no canteens. The catalogue seed runs in production only with ' +
          'DEMO_MODE=true; otherwise run `npm run db:seed --workspace backend` deliberately.',
      );
    } else {
      const result = await seedDatabase(prisma);
      catalogue = 'seeded';
      logger.info(result, 'Catalogue seeded (empty database)');
    }
  }

  let admin: ReleaseResult['admin'] = 'not-configured';
  if (env.ADMIN_BOOTSTRAP_EMAIL && env.ADMIN_BOOTSTRAP_NAME) {
    try {
      const result = await bootstrapAdmin(
        { auth: deps.auth(), prisma },
        {
          email: env.ADMIN_BOOTSTRAP_EMAIL,
          name: env.ADMIN_BOOTSTRAP_NAME,
          allowCreateFirebaseUser: false,
        },
      );
      admin = 'linked';
      logger.info({ adminId: result.adminId }, 'First admin linked (ADMIN_BOOTSTRAP_EMAIL)');
    } catch (err) {
      admin = 'failed';
      logger.error(
        { err: (err as Error).message },
        'First admin not linked; fix ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_NAME and redeploy',
      );
    }
  }
  return { catalogue, admin };
}

// `node dist/ops/release.js`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = loadEnv();
  const logger = createLogger(env);
  const prisma = createPrismaClient(env.DATABASE_URL);
  try {
    await runRelease({ env, logger, prisma, auth: () => createFirebaseAuth(env) });
  } catch (err) {
    logger.fatal({ err }, 'Release tasks failed');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await closeFirebase();
  }
}
