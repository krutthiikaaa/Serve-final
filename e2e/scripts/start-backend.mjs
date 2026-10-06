/**
 * Starts an isolated SERVE backend for the end-to-end suite:
 *   1. resets the TEST database (refuses any database not ending in `_test`),
 *   2. applies every migration and the catalogue seed,
 *   3. provisions the E2E admin through the official bootstrap script,
 *   4. runs the backend on E2E_API_PORT with CORS for the E2E frontends.
 * The development database (`serve_dev`) is never touched.
 */
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { E2E } from '../tests/support/constants.mjs';

const backend = path.resolve(import.meta.dirname, '../../backend');
loadDotenv({ path: path.join(backend, '.env.test'), quiet: true });

const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/none').pathname.slice(1);
if (!dbName.endsWith('_test')) {
  console.error(
    `Refusing to reset database "${dbName}": the E2E suite only uses *_test databases.`,
  );
  process.exit(1);
}

const env = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(E2E.apiPort),
  CORS_ORIGINS: `${E2E.staffUrl},${E2E.adminUrl}`,
  LOG_LEVEL: 'warn',
  ADMIN_BOOTSTRAP_PASSWORD: E2E.password,
};
const run = (cmd, args, input) =>
  execFileSync(cmd, args, {
    cwd: backend,
    env,
    stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    input,
  });

run(
  'npx',
  ['prisma', 'db', 'execute', '--stdin'],
  'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
);
run('npx', ['prisma', 'migrate', 'deploy']);
run('npx', ['tsx', 'prisma/seed.ts']);
run('npx', ['tsx', 'scripts/create-admin.ts', '--email', E2E.adminEmail, '--name', 'E2E Admin']);

const server = spawn('npx', ['tsx', 'src/server.ts'], { cwd: backend, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 0));
