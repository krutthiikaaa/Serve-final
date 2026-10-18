/**
 * npm run smoke:deploy -- https://YOUR_DOMAIN
 *
 * Read-only checks of a running single-domain deployment: the three apps and
 * their deep links, install manifests and icons, the API under /api, security
 * headers, and a Socket.IO WebSocket upgrade through whatever proxy is in
 * front. It never signs in and never writes data.
 *
 *   --insecure   accept a self-signed certificate (local proxy testing only)
 */
import { io } from 'socket.io-client';

const args = process.argv.slice(2);
const insecure = args.includes('--insecure');
const target = args.find((arg) => !arg.startsWith('--'));
if (!target) {
  console.error('Usage: npm run smoke:deploy -- https://YOUR_DOMAIN [--insecure]');
  process.exit(2);
}
if (insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const origin = new URL(target).origin;
const isLocal = ['localhost', '127.0.0.1'].includes(new URL(origin).hostname);

let failures = 0;
async function check(name, fn) {
  try {
    const note = await fn();
    console.log(`✓ ${name}${note ? ` — ${note}` : ''}`);
  } catch (err) {
    failures += 1;
    console.log(`✗ ${name} — ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const get = (path, init) => fetch(new URL(path, origin), init);

await check('served over https', () => {
  assert(origin.startsWith('https://') || isLocal, `${origin} is not https`);
  return origin.startsWith('https://') ? '' : 'local http (fine for testing only)';
});

await check('GET /api/health', async () => {
  const res = await get('/api/health');
  assert(res.status === 200, `status ${res.status}`);
  assert((await res.json()).status === 'ok', 'status is not ok');
});

await check('GET /api/health/db (database reachable)', async () => {
  const res = await get('/api/health/db');
  assert(res.status === 200, `status ${res.status}`);
});

await check('unknown /api routes are JSON 404s', async () => {
  const res = await get('/api/smoke-test-missing-route');
  assert(res.status === 404, `status ${res.status}`);
  assert((await res.json()).error?.code === 'ROUTE_NOT_FOUND', 'not the API error format');
});

const pages = [
  ['/', 'SERVE'],
  ['/orders', 'SERVE'],
  ['/staff/', 'SERVE Staff'],
  ['/staff/orders', 'SERVE Staff'],
  ['/admin/', 'SERVE Admin'],
  ['/admin/change-requests', 'SERVE Admin'],
];
for (const [path, title] of pages) {
  await check(`GET ${path} → ${title}`, async () => {
    const res = await get(path);
    assert(res.status === 200, `status ${res.status}`);
    assert(/text\/html/.test(res.headers.get('content-type') ?? ''), 'not HTML');
    assert((await res.text()).includes(`<title>${title}</title>`), `title is not "${title}"`);
  });
}

await check('/staff redirects to /staff/', async () => {
  const res = await get('/staff', { redirect: 'manual' });
  assert(res.status === 301, `status ${res.status}`);
  assert(new URL(res.headers.get('location') ?? '', origin).pathname === '/staff/', 'location');
});

for (const manifest of [
  '/manifest.json',
  '/staff/manifest.webmanifest',
  '/admin/manifest.webmanifest',
]) {
  await check(`install manifest ${manifest}`, async () => {
    const res = await get(manifest);
    assert(res.status === 200, `status ${res.status}`);
    const json = await res.json();
    assert(json.display === 'standalone', 'display is not standalone');
    const url = new URL(manifest, origin);
    for (const icon of json.icons ?? []) {
      const iconRes = await get(new URL(icon.src, url).pathname);
      assert(iconRes.status === 200, `icon ${icon.src}: ${iconRes.status}`);
    }
    return `${json.name}, ${json.icons?.length ?? 0} icons`;
  });
}

await check('security headers on pages', async () => {
  const res = await get('/staff/');
  const csp = res.headers.get('content-security-policy') ?? '';
  assert(csp.includes("script-src 'self'"), 'missing page Content-Security-Policy');
  assert(res.headers.get('x-content-type-options') === 'nosniff', 'missing nosniff');
  if (origin.startsWith('https://'))
    assert(res.headers.get('strict-transport-security'), 'missing Strict-Transport-Security');
});

await check('Socket.IO upgrades to a WebSocket at /socket.io/', async () => {
  // No token on purpose: reaching the backend's "AUTH_REQUIRED" answer over a
  // WebSocket proves the proxy passes upgrades. Nothing is subscribed.
  const code = await new Promise((resolve, reject) => {
    const socket = io(origin, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 10_000,
      rejectUnauthorized: !insecure,
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('no answer within 10 s'));
    }, 12_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.disconnect();
      reject(new Error('connected without a token — authentication is not enforced'));
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      socket.disconnect();
      resolve(err.data?.code ?? err.message);
    });
  });
  assert(code === 'AUTH_REQUIRED', `upgrade failed: ${code}`);
  return 'unauthenticated socket correctly refused';
});

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
