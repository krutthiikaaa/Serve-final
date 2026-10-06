/**
 * Builds the Flutter student app for the web against the isolated E2E stack
 * and serves it on E2E.studentUrl. Requires the Flutter SDK on PATH (or
 * FLUTTER_BIN). Used only when E2E_STUDENT_WEB=1.
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { E2E } from '../tests/support/constants.mjs';

const app = path.resolve(import.meta.dirname, '../../apps/student');
const out = path.join(app, 'build', 'web-e2e');
const defines = {
  API_URL: E2E.apiUrl,
  FIREBASE_API_KEY: E2E.firebaseApiKey,
  FIREBASE_PROJECT_ID: E2E.firebaseProjectId,
  FIREBASE_AUTH_EMULATOR_HOST: new URL(E2E.emulatorUrl).host,
  STAFF_DASHBOARD_URL: E2E.staffUrl,
  ADMIN_PORTAL_URL: E2E.adminUrl,
};
execFileSync(
  process.env.FLUTTER_BIN ?? 'flutter',
  [
    'build',
    'web',
    '--profile',
    '--no-web-resources-cdn',
    '--output',
    out,
    ...Object.entries(defines).map(([k, v]) => `--dart-define=${k}=${v}`),
  ],
  { cwd: app, stdio: 'inherit' },
);

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.css': 'text/css',
  '.symbols': 'text/plain',
};
http
  .createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let file = path.join(out, pathname);
    if (!file.startsWith(out) || !existsSync(file) || statSync(file).isDirectory())
      file = path.join(out, 'index.html');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  })
  .listen(Number(new URL(E2E.studentUrl).port), '127.0.0.1');
