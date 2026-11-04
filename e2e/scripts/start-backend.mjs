/**
 * Starts an isolated SERVE backend for the end-to-end suite:
 *   1. resets the TEST database (refuses any database not ending in `_test`),
 *   2. applies every migration and the catalogue seed,
 *   3. provisions the E2E admin through the official bootstrap script,
 *   4. runs the backend on E2E_API_PORT with CORS for the E2E frontends.
 * With E2E_WEB_ROOT set it also serves the built web apps from that folder
 * (the single-domain deployment, see start-single-domain.mjs).
 * The development database (`serve_dev`) is never touched.
 *
 * Uses `process.execPath` + local CLI entrypoints so Windows does not need
 * `npx` on PATH (spawnSync('npx') → ENOENT on many Windows setups).
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { E2E } from '../tests/support/constants.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const backend = path.resolve(import.meta.dirname, '../../backend');
loadDotenv({ path: path.join(backend, '.env.test'), quiet: true });

const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/none').pathname.slice(1);
if (!dbName.endsWith('_test')) {
  console.error(
    `Refusing to reset database "${dbName}": the E2E suite only uses *_test databases.`,
  );
  process.exit(1);
}

const prismaJs = [
  path.join(backend, 'node_modules/prisma/build/index.js'),
  path.join(root, 'node_modules/prisma/build/index.js'),
].find((candidate) => existsSync(candidate));
if (!prismaJs) {
  console.error('Prisma CLI was not found in node_modules.');
  process.exit(1);
}

const tsxCli = [
  path.join(backend, 'node_modules/tsx/dist/cli.mjs'),
  path.join(root, 'node_modules/tsx/dist/cli.mjs'),
].find((candidate) => existsSync(candidate));
if (!tsxCli) {
  console.error('tsx CLI was not found in node_modules.');
  process.exit(1);
}

const singleDomain = Boolean(process.env.E2E_WEB_ROOT);
const env = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(E2E.apiPort),
  CORS_ORIGINS: `${E2E.staffUrl},${E2E.adminUrl},${E2E.studentUrl},${E2E.apiUrl}`,
  LOG_LEVEL: 'warn',
  ADMIN_BOOTSTRAP_PASSWORD: E2E.password,
  STUDENT_APP_URL: singleDomain ? E2E.apiUrl : E2E.studentUrl,
  STAFF_DASHBOARD_URL: singleDomain ? `${E2E.apiUrl}/staff` : E2E.staffUrl,
  ADMIN_PORTAL_URL: singleDomain ? `${E2E.apiUrl}/admin` : E2E.adminUrl,
  // Short enough that the expired-callback e2e can wait it out.
  SSO_CODE_TTL_SECONDS: '15',
  ...(singleDomain ? { WEB_ROOT: process.env.E2E_WEB_ROOT } : {}),
};
const run = (args, input) =>
  execFileSync(process.execPath, args, {
    cwd: backend,
    env,
    stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    input,
  });

run(
  [prismaJs, 'db', 'execute', '--stdin'],
  'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
);
run([prismaJs, 'migrate', 'deploy']);
run([tsxCli, 'prisma/seed.ts']);
run([tsxCli, 'scripts/create-admin.ts', '--email', E2E.adminEmail, '--name', 'E2E Admin']);

const server = spawn(process.execPath, [tsxCli, 'src/server.ts'], {
  cwd: backend,
  env,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 0));
