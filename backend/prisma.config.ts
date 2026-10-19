/**
 * Prisma CLI configuration (Prisma 7).
 *
 * The CLI uses the same env-file convention as the application
 * (see src/config/env.ts):
 *   NODE_ENV=development (default) -> backend/.env
 *   NODE_ENV=test                  -> backend/.env.test
 *   NODE_ENV=production            -> no file; real environment only
 *
 * Variables already present in the process environment always win.
 */
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

const nodeEnv = process.env.NODE_ENV ?? 'development';
const envFile = nodeEnv === 'test' ? '.env.test' : nodeEnv === 'production' ? null : '.env';
if (envFile) {
  loadDotenv({ path: path.join(import.meta.dirname, envFile), quiet: true });
}

/**
 * Commands that can drop data run only against the local databases from
 * `npm run db:setup:local` (names ending in _dev or _test), never with
 * NODE_ENV=production. Production applies migrations with `migrate deploy`.
 * A local database with another name can be confirmed explicitly:
 * SERVE_CONFIRM_DESTRUCTIVE_DB=<database name>.
 */
const DESTRUCTIVE_COMMANDS: [string, string][] = [
  ['migrate', 'dev'],
  ['migrate', 'reset'],
  ['db', 'push'],
];
const cliWords = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const destructive = DESTRUCTIVE_COMMANDS.find(([group, action]) => {
  const at = cliWords.indexOf(group);
  return at !== -1 && cliWords[at + 1] === action;
});
if (destructive) {
  let database = '';
  try {
    database = decodeURIComponent(new URL(process.env.DATABASE_URL ?? '').pathname.slice(1));
  } catch {
    // An unreadable URL is refused below.
  }
  const local =
    /_(dev|test)$/.test(database) || process.env.SERVE_CONFIRM_DESTRUCTIVE_DB === database;
  if (nodeEnv === 'production' || !database || !local) {
    throw new Error(
      `Refusing \`prisma ${destructive.join(' ')}\` on database "${database || 'unknown'}": ` +
        'it can drop data and only runs on local *_dev / *_test databases. ' +
        'Production uses `npm run prisma:migrate:deploy --workspace backend`.',
    );
  }
}

export default defineConfig({
  schema: path.join(import.meta.dirname, 'prisma', 'schema.prisma'),
  migrations: {
    path: path.join(import.meta.dirname, 'prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  // Optional for `prisma generate`; required for migrate/introspection commands.
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
