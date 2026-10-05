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

export default defineConfig({
  schema: path.join(import.meta.dirname, 'prisma', 'schema.prisma'),
  migrations: {
    path: path.join(import.meta.dirname, 'prisma', 'migrations'),
  },
  // Optional for `prisma generate`; required for migrate/introspection commands.
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
