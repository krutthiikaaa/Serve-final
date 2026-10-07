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
 * Drives the backend exactly like the Flutter student app does: Firebase
 * (emulator) for identity, then the SERVE REST API with the ID token.
 * Nothing here talks to PostgreSQL directly.
 */
const identity = (path: string) =>
  `${E2E.emulatorUrl}/identitytoolkit.googleapis.com/v1/${path}?key=${E2E.firebaseApiKey}`;

export const uniqueEmail = (prefix: string) =>
  `${prefix}.${Date.now()}.${randomUUID().slice(0, 6)}@serve.test`;

export async function firebaseSignUp(email: string, password = E2E.password): Promise<string> {
  const res = await fetch(identity('accounts:signUp'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`Emulator sign-up failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { idToken: string }).idToken;
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
    const token = await firebaseSignUp(email);
    const hostels = (await (await fetch(`${E2E.apiUrl}/api/hostels`)).json()) as { data: Hostel[] };
    const hostel = hostels.data.find((h) => h.name === hostelName);
    if (!hostel) throw new Error(`Hostel ${hostelName} not seeded`);
    const actor = new StudentActor(token);
    actor.me = await actor.data<MeStudent>('POST', '/auth/student/register', {
      name,
      email,
      hostelId: hostel.id,
    });
    return actor;
  }

  menu(canteenId = this.me.defaultCanteen.id) {
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

export async function adminActor(): Promise<ApiActor> {
  const res = await fetch(identity('accounts:signInWithPassword'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: E2E.adminEmail,
      password: E2E.password,
      returnSecureToken: true,
    }),
  });
  if (!res.ok) throw new Error(`Admin sign-in failed: ${res.status}`);
  return new ApiActor(((await res.json()) as { idToken: string }).idToken);
}

/** A staff member onboarded through the API and approved by the E2E admin. */
export async function approvedStaff(name: string, canteenName: string) {
  const admin = await adminActor();
  const email = uniqueEmail('staff');
  const staff = new ApiActor(await firebaseSignUp(email));
  const canteens = await staff.data<{ id: string; name: string }[]>('GET', '/canteens');
  const canteen = canteens.find((c) => c.name === canteenName);
  if (!canteen) throw new Error(`Canteen ${canteenName} not seeded`);
  await staff.data('POST', '/auth/staff/register', { name, email, requestedCanteenId: canteen.id });
  const pending = await admin.call<{ data: { id: string; staff: { email: string } }[] }>(
    'GET',
    '/admin/change-requests?status=PENDING&limit=100',
  );
  const request = pending.body.data.find((r) => r.staff.email === email);
  if (!request) throw new Error('Change request not found');
  await admin.data('POST', `/admin/change-requests/${request.id}/approve`, {});
  return { email, staff, canteen, admin };
}
