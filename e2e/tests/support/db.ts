import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

/**
 * Direct writes to the isolated E2E database (`*_test` only), for states a
 * test cannot wait for in real time. Uses the same Prisma CLI and env file as
 * scripts/start-backend.mjs.
 */
const root = path.resolve(import.meta.dirname, '../../..');
const backend = path.join(root, 'backend');
const env: Record<string, string | undefined> = { ...process.env };
loadDotenv({ path: path.join(backend, '.env.test'), quiet: true, processEnv: env });

const prismaJs = [
  path.join(backend, 'node_modules/prisma/build/index.js'),
  path.join(root, 'node_modules/prisma/build/index.js'),
].find((candidate) => existsSync(candidate));

function execute(sql: string) {
  const dbName = new URL(env.DATABASE_URL ?? 'postgresql://invalid/none').pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to write to "${dbName}": E2E only touches *_test databases.`);
  }
  if (!prismaJs) throw new Error('Prisma CLI was not found in node_modules.');
  execFileSync(process.execPath, [prismaJs, 'db', 'execute', '--stdin'], {
    cwd: backend,
    env: { ...env, NODE_ENV: 'test' },
    input: sql,
    stdio: ['pipe', 'ignore', 'inherit'],
  });
}

/**
 * Moves an order's payment deadline into the past, as if its payment window
 * had run out; the server's own expiry job then does the rest.
 */
export function backdatePaymentDeadline(orderId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new Error(`Not an order id: ${orderId}`);
  // Prisma stores DateTime as UTC in `timestamp without time zone` columns, so
  // compute the deadline in UTC: a bare now() would be cast to the server's
  // local wall-clock time (e.g. Asia/Kolkata) and land hours in the future.
  execute(
    `UPDATE "Payment" SET "paymentDueAt" = (now() AT TIME ZONE 'UTC') - interval '1 minute' WHERE "orderId" = '${orderId}';`,
  );
}
