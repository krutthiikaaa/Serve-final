/**
 * Single-domain E2E stack: builds the three web apps for a local preview
 * (`npm run build:web -- --local`: Auth Emulator, demo project) and starts the
 * isolated E2E backend serving them, so `/`, `/staff/`, `/admin/`, `/api` and
 * `/socket.io` share one origin (E2E.apiUrl), exactly like a deployment.
 * E2E_SKIP_WEB_BUILD=1 reuses a previous build.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const webRoot = path.join(root, 'dist', 'web-e2e');

if (process.env.E2E_SKIP_WEB_BUILD !== '1' || !existsSync(path.join(webRoot, 'student'))) {
  execFileSync(
    process.execPath,
    [path.join(root, 'scripts', 'build-web.mjs'), '--local', '--out', webRoot],
    { stdio: 'inherit' },
  );
}

const backend = spawn(process.execPath, [path.join(import.meta.dirname, 'start-backend.mjs')], {
  env: { ...process.env, E2E_WEB_ROOT: webRoot },
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => backend.kill(signal));
backend.on('exit', (code) => process.exit(code ?? 0));
