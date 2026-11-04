import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, type Mock } from 'vitest';
import type {
  AdminCanteen,
  AdminCanteenDetail,
  AdminDashboard,
  StaffOrder,
  ChangeRequest,
  MeAdmin,
  PublicCanteen,
  StaffDetail,
  StaffSummary,
} from '@serve/contracts';
import { ToastProvider } from '@serve/web-shared';
import {
  FakeAuthProvider,
  FakeRealtimeProvider,
  createFakeSocket,
  type FakeSocket,
} from '@serve/web-shared/testing';
import type { AdminApi } from '../src/api/admin';
import { AdminApiContext } from '../src/useAdminApi';

let seq = 0;
export const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const at = '2026-10-06T18:00:00.000Z';

export function publicCanteen(
  canteen: Pick<AdminCanteen, 'id' | 'name' | 'slug' | 'location' | 'openingHours' | 'isActive' | 'isAcceptingOrders' | 'status'>,
  overrides: Partial<PublicCanteen> = {},
): PublicCanteen {
  return {
    ...canteen,
    supportedPeriods: ['NIGHT'],
    services: [
      { period: 'NIGHT', isEnabled: true, override: 'FORCE_OPEN', isOpenNow: true },
    ],
    configurationWarnings: [],
    ...overrides,
  };
}

export function adminCanteenDetail(
  canteen: AdminCanteen,
  overrides: Partial<AdminCanteenDetail> = {},
): AdminCanteenDetail {
  const { counts: _counts, ...base } = canteen;
  return {
    ...base,
    hostels: [],
    staff: [],
    menuSummary: { categories: 1, items: 1, availableItems: 1, byCategory: [] },
    services: [
      {
        period: 'NIGHT',
        isEnabled: true,
        override: 'FORCE_OPEN',
        schedules: [],
      },
    ],
    configurationWarnings: [],
    ...overrides,
  };
}

export function adminCanteen(name: string, overrides: Partial<AdminCanteen> = {}): AdminCanteen {
  return {
    id: uuid(),
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    location: 'Campus',
    openingHours: '21:00–03:00',
    isActive: true,
    isAcceptingOrders: true,
    status: 'ACCEPTING_ORDERS',
    counts: { hostels: 2, activeStaff: 1, menuItems: 29 },
    ...overrides,
  };
}

export function changeRequest(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: uuid(),
    status: 'PENDING',
    notes: 'I work the night shift here',
    reviewNotes: null,
    staff: { id: uuid(), name: 'Priya Staff', email: 'priya@serve.dev', status: 'PENDING' },
    requestedCanteen: { id: uuid(), name: 'Vedavathi Night Canteen' },
    fromCanteen: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: at,
    ...overrides,
  };
}

export function staffSummary(overrides: Partial<StaffSummary> = {}): StaffSummary {
  return {
    id: uuid(),
    name: 'Priya Staff',
    email: 'priya@serve.dev',
    status: 'PENDING',
    createdAt: at,
    updatedAt: at,
    canteen: null,
    ...overrides,
  };
}

export function staffDetail(
  summary: StaffSummary,
  requests: StaffDetail['changeRequests'] = [],
  extra: Partial<StaffDetail> = {},
): StaffDetail {
  return { ...summary, changeRequests: requests, ...extra };
}

export function adminDashboard(overrides: Partial<AdminDashboard> = {}): AdminDashboard {
  return {
    canteens: { total: 5, active: 5, acceptingOrders: 4, paused: 1, inactive: 0 },
    services: { dayEnabled: 4, nightEnabled: 5, openNow: 3 },
    staff: { active: 6, pending: 2, rejected: 1, deactivated: 1, cashiers: 2, assignments: 8 },
    payments: { demo: 4, live: 1, incompleteLive: 1 },
    canteenOverview: [
      {
        id: uuid(),
        name: 'Vedavathi Night Canteen',
        isActive: true,
        isAcceptingOrders: false,
        dayConfigured: true,
        nightConfigured: true,
        dayEnabled: true,
        nightEnabled: true,
        dayOpen: false,
        nightOpen: true,
      },
    ],
    pendingChangeRequests: 2,
    orders: { active: 7, awaitingPreparation: 3, preparing: 3, ready: 1 },
    today: {
      since: '2026-10-05T18:30:00.000Z',
      orderCount: 42,
      revenuePaise: 512_500,
      appOrderCount: 30,
      walkInOrderCount: 12,
      createdByStatus: {} as AdminDashboard['today']['createdByStatus'],
    },
    ...overrides,
  };
}

export function staffOrder(overrides: Partial<StaffOrder> = {}): StaffOrder {
  const at = '2026-10-06T18:00:00.000Z';
  return {
    id: uuid(),
    orderNumber: 'SV1024',
    receiptNumber: null,
    channel: 'WALK_IN',
    guestName: 'Guest',
    status: 'PAYMENT_CONFIRMED',
    servicePeriod: 'NIGHT',
    totalPaise: 8000,
    currency: 'INR',
    canteen: { id: uuid(), name: 'Vedavathi Night Canteen' },
    items: [],
    payment: {
      provider: 'UPI',
      status: 'SUCCESS',
      amountPaise: 8000,
      currency: 'INR',
      utr: null,
      verifiedAt: null,
      paidAt: at,
      refundedAt: null,
      failureReason: null,
      isSimulated: true,
    },
    createdAt: at,
    updatedAt: at,
    paidAt: at,
    preparingAt: null,
    readyAt: null,
    collectedAt: null,
    cancelledAt: null,
    cancelReason: null,
    timeline: [],
    student: null,
    ...overrides,
  };
}

export const meAdmin = (overrides: Partial<MeAdmin> = {}): MeAdmin => ({
  registered: true,
  id: uuid(),
  firebaseUid: 'uid-admin',
  name: 'Dev Admin',
  email: 'admin@serve.dev',
  isActive: true,
  role: 'ADMIN',
  ...overrides,
});

type MockedApi = { [K in keyof AdminApi]: Mock<AdminApi[K]> };

export function fakeAdminApi(): MockedApi {
  const names: (keyof AdminApi)[] = [
    'dashboard',
    'paymentOverview',
    'reports',
    'settings',
    'canteens',
    'browseCanteens',
    'canteen',
    'liveCanteen',
    'createCanteen',
    'updateCanteen',
    'updateCanteenServices',
    'updateCanteenSchedule',
    'paymentConfig',
    'updatePaymentConfig',
    'hostels',
    'menuCatalogue',
    'createMenuCategory',
    'updateMenuCategory',
    'createMenuItem',
    'updateMenuItem',
    'updateMenuItemServices',
    'staff',
    'staffMember',
    'assignStaff',
    'updateStaffAssignments',
    'deactivateStaff',
    'changeRequests',
    'approveRequest',
    'rejectRequest',
    'orders',
  ];
  return Object.fromEntries(
    names.map((n) => [
      n,
      vi.fn(async () => {
        throw new Error(`${n} not stubbed`);
      }),
    ]),
  ) as unknown as MockedApi;
}

export function renderAdmin(
  ui: ReactNode,
  {
    api,
    fake = createFakeSocket(),
    path = '/',
  }: { api: MockedApi; fake?: FakeSocket; path?: string },
) {
  const result = render(
    <ToastProvider>
      <FakeAuthProvider me={meAdmin()}>
        <AdminApiContext.Provider value={api as unknown as AdminApi}>
          <FakeRealtimeProvider fake={fake}>
            <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
          </FakeRealtimeProvider>
        </AdminApiContext.Provider>
      </FakeAuthProvider>
    </ToastProvider>,
  );
  return { ...result, fake };
}
