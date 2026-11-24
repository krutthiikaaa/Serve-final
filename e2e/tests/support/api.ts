import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type {
  Hostel,
  MeStudent,
  Menu,
  Quote,
  RealtimeEnvelope,
  StudentOrder,
} from '@serve/contracts';
import { E2E } from './constants.mjs';

/**
 * Drives the backend like the real clients do, then calls the SERVE REST API
 * with `Authorization: Bearer <signed session credential>`:
 * - students: a Google session (the test-only sign-in stands in for Google,
 *   with the same SRM rule);
 * - staff and admins: the real email + password sign-in.
 * Nothing here talks to PostgreSQL directly.
 */
export const uniqueEmail = (prefix: string) =>
  `${prefix}.${Date.now()}.${randomUUID().slice(0, 6)}@srmap.edu.in`;

/** A unique personal address (staff may use Gmail, Outlook…). */
export const uniquePersonalEmail = (prefix: string) =>
  `${prefix}.${Date.now()}.${randomUUID().slice(0, 6)}@gmail.com`;

/** The signed session cookie value from a Better Auth response (the Bearer credential). */
function sessionCredential(res: Response): string | null {
  for (const cookie of res.headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    const [name, ...value] = (pair ?? '').split('=');
    if (name?.trim().endsWith('serve.session_token')) return decodeURIComponent(value.join('='));
  }
  return null;
}

/** Email + password sign-in (staff, admins); resolves with the session credential. */
export async function passwordSignIn(email: string, password = E2E.password): Promise<string> {
  const res = await fetch(`${E2E.apiUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: E2E.staffUrl },
    body: JSON.stringify({ email, password }),
  });
  const token = res.ok ? sessionCredential(res) : null;
  if (!token) throw new Error(`Password sign-in failed: ${res.status} ${await res.text()}`);
  return token;
}

/** Staff self-registration (no session): a PENDING account with a password. */
export async function staffSignUp(
  name: string,
  email: string,
  requestedCanteenId?: string,
  password = E2E.password,
) {
  const res = await fetch(`${E2E.apiUrl}/api/auth/staff/sign-up`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password, requestedCanteenId }),
  });
  if (res.status !== 201)
    throw new Error(`Staff sign-up failed: ${res.status} ${await res.text()}`);
}

/** A canteen from the public service-area directory (what the registration form shows). */
export async function canteenByName(name: string): Promise<{ id: string; name: string }> {
  const res = await fetch(`${E2E.apiUrl}/api/service-areas`);
  const areas = ((await res.json()) as { data: { canteens: { id: string; name: string }[] }[] })
    .data;
  const canteen = areas.flatMap((area) => area.canteens).find((c) => c.name === name);
  if (!canteen) throw new Error(`Canteen ${name} not seeded`);
  return canteen;
}

/** A real Better Auth Google session (test-only stand-in) for a verified @srmap.edu.in identity. */
export async function testSignIn(email: string): Promise<string> {
  const res = await fetch(`${E2E.apiUrl}/api/auth/test/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`Test sign-in failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { token: string }).token;
}

export class ApiActor {
  constructor(readonly token: string) {}

  async call<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const res = await fetch(`${E2E.apiUrl}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = res.status === 204 ? undefined : await res.json();
    return { status: res.status, body: json as T };
  }

  async data<T>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const res = await this.call<{ data: T; error?: { code: string; message: string } }>(
      method,
      path,
      body,
      headers,
    );
    if (res.status >= 400)
      throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data;
  }

  /** Authenticated socket; the server decides the rooms. */
  async socket(): Promise<LiveSocket> {
    const socket = io(E2E.apiUrl, {
      transports: ['websocket'],
      auth: { token: this.token },
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return new LiveSocket(socket);
  }
}

export class StudentActor extends ApiActor {
  me!: MeStudent;

  static async register(name: string, hostelName = 'Krishna') {
    const email = uniqueEmail('student');
    const token = await testSignIn(email);
    const hostels = (await (await fetch(`${E2E.apiUrl}/api/hostels`)).json()) as { data: Hostel[] };
    const hostel = hostels.data.find((h) => h.name === hostelName);
    if (!hostel) throw new Error(`Hostel ${hostelName} not seeded`);
    const actor = new StudentActor(token);
    actor.me = await actor.data<MeStudent>('POST', '/auth/student/register', {
      name,
      hostelId: hostel.id,
    });
    return actor;
  }

  menu(canteenId = this.me.defaultCanteen!.id) {
    return this.data<Menu>('GET', `/canteens/${canteenId}/menu`);
  }

  quote(canteenId: string, items: { menuItemId: string; quantity: number }[]) {
    return this.data<Quote>('POST', '/cart/quote', { canteenId, items });
  }

  placeOrder(canteenId: string, items: { menuItemId: string; quantity: number }[]) {
    return this.call<{ data: StudentOrder; error?: { code: string } }>(
      'POST',
      '/orders',
      { canteenId, items },
      { 'Idempotency-Key': randomUUID() },
    );
  }

  /** Mock gateway: initiate, then complete — the same calls the student app makes. */
  async pay(orderId: string) {
    await this.data('POST', `/payments/${orderId}/initiate`);
    return this.data<{ order: StudentOrder }>('POST', `/payments/${orderId}/mock-complete`, {});
  }

  /** Orders and pays for the first available items of the default canteen. */
  async orderAndPay(quantity = 2) {
    const menu = await this.menu();
    const item = menu.categories.flatMap((c) => c.items).find((i) => i.isOrderable);
    if (!item) throw new Error('No orderable item');
    const placed = await this.placeOrder(menu.canteen.id, [{ menuItemId: item.id, quantity }]);
    if (placed.status !== 201) throw new Error(`Order failed: ${JSON.stringify(placed.body)}`);
    const paid = await this.pay(placed.body.data.id);
    return { order: paid.order, item };
  }
}

/** Collects every event a socket receives, so tests can assert presence and absence. */
export class LiveSocket {
  readonly events: RealtimeEnvelope<unknown>[] = [];

  constructor(readonly socket: Socket) {
    socket.onAny((name: string, envelope: RealtimeEnvelope<unknown>) => {
      if (envelope && typeof envelope === 'object' && 'data' in envelope)
        this.events.push({ ...envelope, type: name });
    });
  }

  of<T = unknown>(type: string) {
    return this.events.filter((e) => e.type === type).map((e) => e.data as T);
  }

  async waitFor<T = unknown>(
    type: string,
    predicate: (data: T) => boolean = () => true,
    timeoutMs = 10_000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.of<T>(type).find(predicate);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      `Timed out waiting for ${type}; received: ${this.events.map((e) => e.type).join(', ') || 'nothing'}`,
    );
  }

  subscribeMenu(canteenId: string) {
    return new Promise<{ ok: boolean }>((resolve) =>
      this.socket.emit('menu:subscribe', { canteenId }, resolve),
    );
  }

  close() {
    this.socket.disconnect();
  }
}

/** The E2E admin (provisioned with a password by start-backend.mjs), signed in with it. */
export async function adminActor(): Promise<ApiActor> {
  return new ApiActor(await passwordSignIn(E2E.adminEmail));
}

/**
 * A staff member registered with a personal address and a password, then
 * approved by the E2E admin. Sign in with `email` and `E2E.password`.
 */
export async function approvedStaff(name: string, canteenName: string) {
  const admin = await adminActor();
  const email = uniquePersonalEmail('staff');
  const canteen = await canteenByName(canteenName);
  await staffSignUp(name, email, canteen.id);
  const pending = await admin.call<{ data: { id: string; staff: { email: string } }[] }>(
    'GET',
    '/admin/change-requests?status=PENDING&limit=100',
  );
  const request = pending.body.data.find((r) => r.staff.email === email);
  if (!request) throw new Error('Change request not found');
  // Each canteen has one dedicated account: this test's account replaces any earlier one.
  await admin.data('POST', `/admin/change-requests/${request.id}/approve`, {
    replaceExisting: true,
  });
  const staff = new ApiActor(await passwordSignIn(email));
  return { email, staff, canteen, admin };
}
