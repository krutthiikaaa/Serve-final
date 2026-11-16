import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../src/config/env.js';
import { createPrismaClient } from '../src/lib/prisma.js';

/**
 * Runs once before the whole suite:
 *  1. Recreates the PostgreSQL *test* database schema from scratch and applies
 *     every migration with `prisma migrate deploy` — this proves the migration
 *     history works on a clean database on every run.
 * Authentication needs no external service: Better Auth runs in-process
 * against this database (see helpers/identity.ts).
 *
 * Guard: only ever touches a database whose name ends in `_test`.
 */
export default async function setup(): Promise<void> {
  process.env.NODE_ENV = 'test';
  const env = loadEnv();
  const dbName = new URL(env.DATABASE_URL).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to reset database "${dbName}": test database names must end in _test`,
    );
  }

  const prisma = createPrismaClient(env.DATABASE_URL);
  try {
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  } finally {
    await prisma.$disconnect();
  }

  const backendRoot = path.resolve(import.meta.dirname, '..');
  const prismaJs = ['node_modules/prisma/build/index.js', '../node_modules/prisma/build/index.js']
    .map((relative) => path.resolve(backendRoot, relative))
    .find((candidate) => existsSync(candidate));
  if (!prismaJs) throw new Error('Prisma CLI was not found in node_modules.');
  execFileSync(process.execPath, [prismaJs, 'migrate', 'deploy'], {
    cwd: backendRoot,
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'pipe',
  });
}
