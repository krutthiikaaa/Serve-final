/**
 * npm run build:web — builds the three web apps for the single-domain
 * deployment and assembles them in one folder for the backend's WEB_ROOT:
 *
 *   dist/web/student   Flutter web build, served at /
 *   dist/web/staff     staff dashboard, served at /staff/
 *   dist/web/admin     admin portal, served at /admin/
 *
 * Production (default) needs the PUBLIC Firebase web config in the environment:
 *   FIREBASE_API_KEY=… FIREBASE_PROJECT_ID=… npm run build:web
 * Optional: FIREBASE_AUTH_DOMAIN, and API_URL (https) only when the backend is
 * NOT on the same origin as the pages. Unset = same origin (/api, /socket.io).
 *
 *   npm run build:web -- --local     Builds for a local single-domain preview
 *                                    against the Firebase Auth Emulator and
 *                                    the demo-serve project (never deploy it).
 *   npm run build:web -- --out <dir> Output folder (default dist/web).
 *
 * Firebase Admin credentials, database URLs and payment secrets are never used
 * here: everything in these builds is public.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const root = path.resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    local: { type: 'boolean', default: false },
    out: { type: 'string', default: path.join(root, 'dist', 'web') },
  },
});
const local = values.local;
const out = path.resolve(values.out);
const MARKER = '.serve-web-build';
const flutter = process.env.FLUTTER_BIN ?? 'flutter';
const shell = process.platform === 'win32';

function fail(message) {
  console.error(`build:web: ${message}`);
  process.exit(1);
}

function run(command, args, options) {
  console.log(`> ${path.relative(root, options.cwd) || '.'}$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell, ...options });
  if (result.status !== 0) fail(`${command} failed`);
}

// --- configuration ------------------------------------------------------------
const apiUrl = process.env.API_URL ?? '';
let firebase;
if (local) {
  firebase = {
    apiKey: 'demo-api-key',
    projectId: 'demo-serve',
    emulatorUrl: process.env.FIREBASE_AUTH_EMULATOR_URL ?? 'http://127.0.0.1:9099',
  };
} else {
  const missing = ['FIREBASE_API_KEY', 'FIREBASE_PROJECT_ID'].filter((key) => !process.env[key]);
  if (missing.length > 0) {
    fail(
      `set ${missing.join(' and ')} (public Firebase web config; see docs/deployment.md), ` +
        'or use --local for a local preview against the Auth Emulator.',
    );
  }
  firebase = {
    apiKey: process.env.FIREBASE_API_KEY,
    projectId: process.env.FIREBASE_PROJECT_ID,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN ?? '',
  };
  if (firebase.projectId.startsWith('demo-'))
    fail('demo- Firebase projects only exist in the emulator; use --local for a local preview.');
  if (apiUrl && !apiUrl.startsWith('https://')) fail('API_URL must use https (or be unset).');
}

// Refuse to delete anything that is not a previous build:web output.
const unsafeOut = [path.parse(out).root, root, path.dirname(root), process.env.HOME ?? ''];
if (unsafeOut.includes(out)) fail(`refusing to use ${out} as the output folder.`);
if (existsSync(out) && readdirSync(out).length > 0 && !existsSync(path.join(out, MARKER))) {
  fail(`${out} exists and was not created by build:web; choose an empty folder with --out.`);
}
if (spawnSync(flutter, ['--version'], { shell, stdio: 'ignore' }).status !== 0) {
  fail('Flutter was not found. Install Flutter 3.47+ or set FLUTTER_BIN to its full path.');
}

// --- staff and admin (Vite; base /staff/ and /admin/ come from vite.config.ts) --
const staging = path.join(root, 'dist', '.web-staging');
rmSync(staging, { recursive: true, force: true });
const viteEnv = {
  ...process.env,
  VITE_API_URL: apiUrl,
  VITE_FIREBASE_API_KEY: firebase.apiKey,
  VITE_FIREBASE_PROJECT_ID: firebase.projectId,
  VITE_FIREBASE_AUTH_DOMAIN: firebase.authDomain ?? '',
  VITE_FIREBASE_AUTH_EMULATOR_URL: firebase.emulatorUrl ?? '',
};
for (const app of ['staff', 'admin']) {
  const cwd = path.join(root, 'apps', app);
  run('npx', ['tsc', '--noEmit'], { cwd });
  // "local-demo" mode skips the production-only checks (the emulator is allowed).
  const mode = local ? ['--mode', 'local-demo'] : [];
  run('npx', ['vite', 'build', ...mode, '--outDir', path.join(staging, app), '--emptyOutDir'], {
    cwd,
    env: viteEnv,
  });
}

// --- student (Flutter web, served at /) ---------------------------------------
// --no-web-resources-cdn: the Flutter renderer is served from this origin
// (the page CSP allows no third-party scripts). --csp: no eval in the output.
const defines = local
  ? {}
  : {
      FIREBASE_API_KEY: firebase.apiKey,
      FIREBASE_PROJECT_ID: firebase.projectId,
      ...(apiUrl ? { API_URL: apiUrl } : {}),
    };
run(
  flutter,
  [
    'build',
    'web',
    local ? '--profile' : '--release',
    '--base-href',
    '/',
    '--no-web-resources-cdn',
    '--csp',
    '--output',
    path.join(staging, 'student'),
    ...Object.entries(defines).map(([key, value]) => `--dart-define=${key}=${value}`),
  ],
  { cwd: path.join(root, 'apps', 'student') },
);

// --- assemble -----------------------------------------------------------------
rmSync(out, { recursive: true, force: true });
mkdirSync(path.dirname(out), { recursive: true });
cpSync(staging, out, { recursive: true });
rmSync(staging, { recursive: true, force: true });
writeFileSync(
  path.join(out, MARKER),
  `${JSON.stringify({ local, builtAt: new Date().toISOString() })}\n`,
);
console.log(
  `\nWeb apps ready in ${path.relative(root, out) || out}` +
    (local ? ' (LOCAL PREVIEW: emulator + demo project; never deploy this build)' : '') +
    `\nServe them with the backend: WEB_ROOT=${out}`,
);
