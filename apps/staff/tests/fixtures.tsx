import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, type Mock } from 'vitest';
import type {
  CategoryWithItems,
  MeStaff,
  MenuItem,
  OrderStatus,
  StaffDashboard,
  StaffOrder,
} from '@serve/contracts';
import { ToastProvider } from '@serve/web-shared';
import {
  FakeAuthProvider,
  FakeRealtimeProvider,
  createFakeSocket,
  type FakeSocket,
} from '@serve/web-shared/testing';
import type { StaffApi } from '../src/api/staff';
import { StaffApiContext } from '../src/useStaffApi';

export const CANTEEN_ID = '7d2c6a52-6f3e-4a35-9a3b-1c2d3e4f5a60';
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

export function order(status: OrderStatus, overrides: Partial<StaffOrder> = {}): StaffOrder {
  const id = uuid();
  const at = '2026-10-06T19:00:00.000Z';
  return {
    id,
    orderNumber: `SV${1000 + seq}`,
    status,
    totalPaise: 12_000,
    currency: 'INR',
    canteen: { id: CANTEEN_ID, name: 'Krishna & Godavari Night Canteen' },
    student: { id: uuid(), name: 'Asha Rao' },
    items: [
      {
        id: uuid(),
        menuItemId: uuid(),
        itemName: 'Veg Sandwich',
        unitPricePaise: 6_000,
        quantity: 2,
        lineTotalPaise: 12_000,
      },
    ],
    payment: {
      provider: 'MOCK',
      status: 'SUCCESS',
      amountPaise: 12_000,
      currency: 'INR',
      paidAt: at,
      refundedAt: null,
      failureReason: null,
    },
    createdAt: at,
    updatedAt: at,
    paidAt: at,
    preparingAt: null,
    readyAt: null,
    collectedAt: null,
    cancelledAt: null,
    cancelReason: null,
    timeline: [
      { status: 'PLACED', at },
      { status: 'PAYMENT_CONFIRMED', at },
    ],
    ...overrides,
  };
}

/** The same order after a server-side transition (newer updatedAt). */
export function advanced(
  o: StaffOrder,
  status: OrderStatus,
  extra: Partial<StaffOrder> = {},
): StaffOrder {
  const at = new Date(Date.parse(o.updatedAt) + 60_000).toISOString();
  return { ...o, status, updatedAt: at, timeline: [...o.timeline, { status, at }], ...extra };
}

export function menuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: uuid(),
    canteenId: CANTEEN_ID,
    categoryId: overrides.categoryId ?? uuid(),
    name: 'Masala Dosa',
    description: 'Crisp dosa with potato masala',
    pricePaise: 6_000,
    imageUrl: null,
    isAvailable: true,
    isActive: true,
    availability: 'AVAILABLE',
    isOrderable: true,
    updatedAt: '2026-10-06T18:00:00.000Z',
    ...overrides,
  };
}

export function category(
  name: string,
  items: Partial<MenuItem>[] = [],
  overrides: Partial<CategoryWithItems> = {},
): CategoryWithItems {
  const id = uuid();
  return {
    id,
    canteenId: CANTEEN_ID,
    name,
    sortOrder: 0,
    isActive: true,
    updatedAt: '2026-10-06T18:00:00.000Z',
    items: items.map((i) => menuItem({ ...i, categoryId: id })),
    ...overrides,
  };
}

export const canteen = {
  id: CANTEEN_ID,
  name: 'Krishna & Godavari Night Canteen',
  slug: 'krishna-godavari',
  location: 'Between Krishna and Godavari hostels',
  openingHours: '21:00–03:00',
  isActive: true,
  isAcceptingOrders: true,
  status: 'ACCEPTING_ORDERS' as const,
};

export function dashboard(
  overrides: Partial<StaffDashboard['orders']> = {},
  accepting = true,
): StaffDashboard {
  return {
    canteen: {
      ...canteen,
      isAcceptingOrders: accepting,
      status: accepting ? 'ACCEPTING_ORDERS' : 'PAUSED',
    },
    orders: { active: 6, awaitingPreparation: 3, preparing: 2, ready: 1, ...overrides },
    today: { since: '2026-10-05T18:30:00.000Z', orderCount: 14, revenuePaise: 186_000 },
  };
}

export function meStaff(overrides: Partial<MeStaff> = {}): MeStaff {
  return {
    registered: true,
    id: uuid(),
    firebaseUid: 'uid-staff',
    name: 'Kiran Staff',
    email: 'staff.kg@serve.dev',
    isActive: true,
    role: 'STAFF',
    status: 'APPROVED',
    canteen: { id: CANTEEN_ID, name: canteen.name, isActive: true, isAcceptingOrders: true },
    pendingChangeRequest: null,
    ...overrides,
  };
}

type MockedApi = { [K in keyof StaffApi]: Mock<StaffApi[K]> };

/** Every endpoint is a mock that fails loudly unless a test gives it behaviour. */
export function fakeStaffApi(): MockedApi {
  const notStubbed = (name: string) =>
    vi.fn(async () => {
      throw new Error(`${name} not stubbed`);
    });
  const names: (keyof StaffApi)[] = [
    'registerStaff',
    'canteens',
    'requestAccess',
    'changeRequests',
    'dashboard',
    'setAcceptingOrders',
    'orders',
    'order',
    'setOrderStatus',
    'menu',
    'createCategory',
    'updateCategory',
    'createItem',
    'updateItem',
    'setAvailability',
    'disableItem',
  ];
  return Object.fromEntries(names.map((n) => [n, notStubbed(n)])) as unknown as MockedApi;
}

export function renderStaff(
  ui: ReactNode,
  {
    api,
    fake = createFakeSocket(),
    me = meStaff(),
  }: { api: MockedApi; fake?: FakeSocket; me?: MeStaff },
) {
  const tree = (epoch: number) => (
    <ToastProvider>
      <FakeAuthProvider me={me}>
        <StaffApiContext.Provider value={api as unknown as StaffApi}>
          <FakeRealtimeProvider fake={fake} connectionEpoch={epoch}>
            <MemoryRouter>{ui}</MemoryRouter>
          </FakeRealtimeProvider>
        </StaffApiContext.Provider>
      </FakeAuthProvider>
    </ToastProvider>
  );
  const result = render(tree(1));
  /** Simulates a socket reconnect (the provider bumps its connection epoch). */
  const reconnect = (epoch = 2) => result.rerender(tree(epoch));
  return { ...result, fake, reconnect };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
