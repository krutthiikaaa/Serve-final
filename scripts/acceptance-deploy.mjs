/**
 * npm run acceptance:deploy -- https://YOUR_DOMAIN
 *
 * Signed-in acceptance test of a running SERVE deployment, through the same
 * REST API and Socket.IO connection the apps use. Complements the read-only
 * `npm run smoke:deploy`. It needs real accounts and a demo deployment
 * (DEMO_MODE=true: payments are simulated), and it writes a little data:
 *
 *   - one order by the student, paid with the demo gateway and walked to
 *     COLLECTED by the staff member;
 *   - one menu item of the staff member's canteen briefly marked unavailable,
 *     then restored;
 *   - with ACCEPT_APPLICANT_*: that account requests staff access, the admin
 *     approves it, and the admin then deactivates it again. Use a throwaway
 *     account; it ends deactivated.
 *
 * Environment (never commit these; pass them in the shell):
 *   FIREBASE_API_KEY                         public Firebase web API key of the deployment
 *   ACCEPT_STUDENT_EMAIL / _PASSWORD         a registered student
 *   ACCEPT_STAFF_EMAIL / _PASSWORD           an approved staff member (canteen accepting orders)
 *   ACCEPT_ADMIN_EMAIL / _PASSWORD           an admin
 *   ACCEPT_APPLICANT_EMAIL / _PASSWORD       optional: a Firebase account with no SERVE role yet
 *   FIREBASE_AUTH_EMULATOR_URL               local testing only, e.g. http://127.0.0.1:9099
 *
 *   --insecure   accept a self-signed certificate (local proxy testing only)
 */
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith('--'));
if (!target) {
  console.error('Usage: npm run acceptance:deploy -- https://YOUR_DOMAIN [--insecure]');
  process.exit(2);
}
if (args.includes('--insecure')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const origin = new URL(target).origin;
const env = process.env;

const missing = [
  'ACCEPT_STUDENT_EMAIL',
  'ACCEPT_STUDENT_PASSWORD',
  'ACCEPT_STAFF_EMAIL',
  'ACCEPT_STAFF_PASSWORD',
  'ACCEPT_ADMIN_EMAIL',
  'ACCEPT_ADMIN_PASSWORD',
].filter((key) => !env[key]);
if (!env.FIREBASE_API_KEY && !env.FIREBASE_AUTH_EMULATOR_URL) missing.unshift('FIREBASE_API_KEY');
if (missing.length > 0) {
  console.error(`Set ${missing.join(', ')} (see the header of scripts/acceptance-deploy.mjs).`);
  process.exit(2);
}

// --- reporting ------------------------------------------------------------------
let failures = 0;
let skipped = 0;
const ok = (name, note) => console.log(`✓ ${name}${note ? ` — ${note}` : ''}`);
const fail = (name, why) => {
  failures += 1;
  console.log(`✗ ${name} — ${why}`);
};
const skip = (name, why) => {
  skipped += 1;
  console.log(`- ${name} — skipped: ${why}`);
};
function check(name, condition, why = 'unexpected response') {
  if (condition) ok(name);
  else fail(name, why);
  return Boolean(condition);
}
class Stop extends Error {}
const must = (name, condition, why) => {
  if (!check(name, condition, why)) throw new Stop(name);
};

// --- Firebase Auth (what the apps' sign-in does) --------------------------------
const identityBase = env.FIREBASE_AUTH_EMULATOR_URL
  ? `${env.FIREBASE_AUTH_EMULATOR_URL.replace(/\/$/, '')}/identitytoolkit.googleapis.com`
  : 'https://identitytoolkit.googleapis.com';
async function signIn(email, password) {
  const res = await fetch(
    `${identityBase}/v1/accounts:signInWithPassword?key=${env.FIREBASE_API_KEY ?? 'demo-api-key'}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: `${origin}/` },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return body.idToken;
}

// --- REST and Socket.IO (what the apps' clients do) -----------------------------
async function api(token, method, path, body, headers = {}) {
  const res = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json, data: json?.data };
}
const why = (res) => `HTTP ${res.status} ${res.body?.error?.code ?? ''}`.trim();

function connect(token) {
  return new Promise((resolve) => {
    const events = [];
    const socket = io(origin, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    socket.onAny((name, envelope) => events.push({ name, data: envelope?.data ?? {} }));
    const waitFor = (name, match, timeout = 10_000) =>
      new Promise((done) => {
        const started = Date.now();
        const tick = () => {
          const hit = events.find((e) => e.name === name && match(e.data));
          if (hit) return done(hit.data);
          if (Date.now() - started > timeout) return done(null);
          setTimeout(tick, 100);
        };
        tick();
      });
    const live = { socket, waitFor, error: null };
    socket.once('connect', () => resolve(live));
    socket.once('connect_error', (err) => {
      live.error = err.data?.code ?? err.message;
      resolve(live);
    });
  });
}

// ================================================================================
const sockets = [];
let restoreItem = null;
let studentToken, staffToken, adminToken;
console.log(`SERVE acceptance test against ${origin}\n`);
try {
  // ---------------------------------------------------------- unauthenticated
  let res = await api(null, 'GET', '/auth/me');
  check('protected API without a token → 401', res.status === 401, why(res));
  const anonymous = await connect(undefined);
  check(
    'Socket.IO without a token is refused',
    anonymous.error === 'AUTH_REQUIRED',
    anonymous.error ?? 'connected',
  );
  anonymous.socket.close();

  // ------------------------------------------------------------------ sign in
  try {
    [studentToken, staffToken, adminToken] = await Promise.all([
      signIn(env.ACCEPT_STUDENT_EMAIL, env.ACCEPT_STUDENT_PASSWORD),
      signIn(env.ACCEPT_STAFF_EMAIL, env.ACCEPT_STAFF_PASSWORD),
      signIn(env.ACCEPT_ADMIN_EMAIL, env.ACCEPT_ADMIN_PASSWORD),
    ]);
    ok('student, staff and admin sign in with Firebase');
  } catch (err) {
    fail('student, staff and admin sign in with Firebase', err.message);
    throw new Stop('sign-in');
  }
  const [studentMe, staffMe, adminMe] = await Promise.all(
    [studentToken, staffToken, adminToken].map((t) => api(t, 'GET', '/auth/me')),
  );
  must('student account (/api/auth/me)', studentMe.data?.role === 'STUDENT', why(studentMe));
  must(
    'approved staff account with a canteen',
    staffMe.data?.role === 'STAFF' && staffMe.data.status === 'APPROVED' && staffMe.data.canteen,
    staffMe.data ? `role ${staffMe.data.role}, status ${staffMe.data.status}` : why(staffMe),
  );
  must('admin account', adminMe.data?.role === 'ADMIN', why(adminMe));
  const canteen = staffMe.data.canteen;

  // ------------------------------------------------------------ authorization
  for (const [name, token, method, path] of [
    ['a student cannot use staff APIs', studentToken, 'GET', '/staff/dashboard'],
    ['a student cannot use admin APIs', studentToken, 'GET', '/admin/dashboard'],
    ['staff cannot use admin APIs', staffToken, 'GET', '/admin/dashboard'],
    ['staff cannot place student orders', staffToken, 'GET', '/orders'],
  ]) {
    res = await api(token, method, path);
    check(`${name} (403)`, res.status === 403, why(res));
  }

  const [student, staff, admin] = await Promise.all(
    [studentToken, staffToken, adminToken].map(connect),
  );
  sockets.push(student, staff, admin);
  check(
    'student, staff and admin connect to Socket.IO (WSS through the proxy)',
    !student.error && !staff.error && !admin.error,
    student.error ?? staff.error ?? admin.error,
  );

  // ------------------------------------------------------------ student order
  res = await api(studentToken, 'GET', '/canteens');
  const listed = res.data?.find((c) => c.id === canteen.id);
  must(`student sees ${canteen.name}`, listed, why(res));
  must(
    `${canteen.name} is accepting orders`,
    listed.isAcceptingOrders,
    'resume order-taking first',
  );
  res = await api(studentToken, 'GET', `/canteens/${canteen.id}/menu`);
  const item = res.data?.categories?.flatMap((c) => c.items).find((i) => i.isAvailable);
  must('menu loads with an available item', item, why(res));
  const sub = await new Promise((done) =>
    student.socket.emit('menu:subscribe', { canteenId: canteen.id }, done),
  );
  check('student subscribes to live menu updates', sub?.ok === true);
  const lines = [{ menuItemId: item.id, quantity: 1 }];
  res = await api(studentToken, 'POST', '/cart/quote', { canteenId: canteen.id, items: lines });
  must('cart quote from the backend', res.data?.totalPaise === item.pricePaise, why(res));
  res = await api(
    studentToken,
    'POST',
    '/orders',
    { canteenId: canteen.id, items: lines },
    {
      'Idempotency-Key': randomUUID(),
    },
  );
  const order = res.data;
  must(
    'checkout creates an order with a server order number',
    res.status === 201 && order?.orderNumber,
    why(res),
  );
  res = await api(studentToken, 'POST', `/payments/${order.id}/initiate`);
  must('payment starts for the server total', res.data?.amountPaise === order.totalPaise, why(res));
  res = await api(studentToken, 'POST', `/payments/${order.id}/mock-complete`, {
    outcome: 'success',
  });
  if (res.status === 404) {
    skip(
      'demo payment',
      'the deployment has no demo gateway (DEMO_MODE is off); finish the order by hand',
    );
    throw new Stop('payment');
  }
  must(
    'demo payment confirms the order',
    res.data?.order?.status === 'PAYMENT_CONFIRMED',
    why(res),
  );
  check(
    'staff receive the paid order live',
    await staff.waitFor('order.payment_confirmed', (d) => d.order?.id === order.id),
    'no order.payment_confirmed event',
  );
  check(
    'admins receive it live',
    await admin.waitFor('order.payment_confirmed', (d) => d.order?.id === order.id),
    'no event',
  );

  // ------------------------------------------------------------ staff kitchen
  for (const status of ['PREPARING', 'READY', 'COLLECTED']) {
    res = await api(staffToken, 'PATCH', `/staff/orders/${order.id}/status`, { status });
    check(`staff mark ${order.orderNumber} ${status}`, res.data?.status === status, why(res));
    const event = await student.waitFor(
      `order.${status.toLowerCase()}`,
      (d) => d.order?.id === order.id,
    );
    check(
      `student sees ${status} live, without refreshing`,
      event?.order?.status === status,
      'no event',
    );
  }
  res = await api(studentToken, 'GET', `/orders/${order.id}`);
  check('order tracking shows COLLECTED', res.data?.status === 'COLLECTED', why(res));
  res = await api(studentToken, 'GET', '/orders?status=past');
  check(
    'order history lists it',
    res.data?.some((o) => o.id === order.id),
    why(res),
  );

  // -------------------------------------------------------------- live menu
  res = await api(staffToken, 'PATCH', `/staff/menu/items/${item.id}/availability`, {
    isAvailable: false,
  });
  if (check('staff mark an item unavailable', res.data?.isAvailable === false, why(res))) {
    restoreItem = item.id;
    check(
      'student menu updates live',
      await student.waitFor(
        'menu.item_availability_changed',
        (d) => d.itemId === item.id && !d.isAvailable,
      ),
      'no menu event',
    );
  }
  res = await api(staffToken, 'PATCH', `/staff/menu/items/${item.id}/availability`, {
    isAvailable: true,
  });
  if (check('staff make it available again', res.data?.isAvailable === true, why(res)))
    restoreItem = null;

  // ------------------------------------------------------------------ admin
  for (const [name, path] of [
    ['admin dashboard', '/admin/dashboard'],
    ['admin staff list', '/admin/staff'],
    ['admin canteens', '/admin/canteens'],
    ['admin canteen detail', `/admin/canteens/${canteen.id}`],
    ['admin change requests', '/admin/change-requests?status=PENDING'],
  ]) {
    res = await api(adminToken, 'GET', path);
    check(name, res.status === 200, why(res));
  }

  // ------------------------------------------- staff approval (optional)
  if (!env.ACCEPT_APPLICANT_EMAIL || !env.ACCEPT_APPLICANT_PASSWORD) {
    skip('admin approves a staff applicant live', 'set ACCEPT_APPLICANT_EMAIL / _PASSWORD');
  } else {
    const applicantToken = await signIn(env.ACCEPT_APPLICANT_EMAIL, env.ACCEPT_APPLICANT_PASSWORD);
    let me = (await api(applicantToken, 'GET', '/auth/me')).data;
    if (!me?.registered) {
      res = await api(applicantToken, 'POST', '/auth/staff/register', {
        name: 'Acceptance Applicant',
        email: env.ACCEPT_APPLICANT_EMAIL,
        requestedCanteenId: canteen.id,
      });
      check('applicant requests staff access', res.status === 201, why(res));
    } else if (me.role === 'STAFF' && me.status === 'REJECTED') {
      res = await api(applicantToken, 'POST', '/staff/change-requests', {
        requestedCanteenId: canteen.id,
      });
      check('rejected applicant requests access again', res.status === 201, why(res));
    }
    me = (await api(applicantToken, 'GET', '/auth/me')).data;
    if (me?.role !== 'STAFF' || me.status !== 'PENDING') {
      skip(
        'admin approves a staff applicant live',
        `applicant is ${me?.role ?? 'unregistered'} ${me?.status ?? ''}; use a fresh account`,
      );
    } else {
      const applicant = await connect(applicantToken);
      sockets.push(applicant);
      res = await api(adminToken, 'GET', '/admin/change-requests?status=PENDING&limit=100');
      const request = res.data?.find((r) => r.staff.id === me.id);
      must('admin sees the access request', request, why(res));
      res = await api(adminToken, 'POST', `/admin/change-requests/${request.id}/approve`, {});
      check('admin approves it', res.status === 200, why(res));
      check(
        'applicant receives the approval live',
        await applicant.waitFor('staff.approved', () => true),
        'no event',
      );
      res = await api(applicantToken, 'GET', '/staff/dashboard');
      check(
        'approved staff can open the dashboard',
        res.data?.canteen?.id === canteen.id,
        why(res),
      );
      res = await api(adminToken, 'POST', `/admin/staff/${me.id}/deactivate`, {});
      check('cleanup: admin deactivates the applicant again', res.status === 200, why(res));
    }
  }
} catch (err) {
  if (!(err instanceof Stop))
    fail('unexpected error', err instanceof Error ? err.message : String(err));
} finally {
  if (restoreItem) {
    const res = await api(staffToken, 'PATCH', `/staff/menu/items/${restoreItem}/availability`, {
      isAvailable: true,
    }).catch(() => null);
    if (res?.data?.isAvailable !== true)
      console.log(`! Mark menu item ${restoreItem} available again in the staff dashboard.`);
  }
  for (const live of sockets) live.socket.close();
}

console.log(
  failures === 0
    ? `\nAll checks passed${skipped ? ` (${skipped} skipped)` : ''}.`
    : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
