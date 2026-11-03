import type {
  AdminCanteen,
  AdminCanteenDetail,
  AdminCanteenService,
  AdminDashboard,
  AdminHostel,
  AdminMenuCategory,
  AdminOperatingSchedule,
  Canteen,
  CanteenPaymentConfig,
  ChangeRequest,
  MenuItemServiceConfig,
  MenuItemServices,
  OrderStatus,
  Page,
  PublicCanteen,
  ScheduleOverride,
  ServicePeriod,
  StaffAssignment,
  StaffCapability,
  StaffDetail,
  StaffOrder,
  StaffStatus,
  StaffSummary,
} from '@serve/contracts';
import type { ApiClient } from '@serve/web-shared';

export type ChangeRequestStatus = ChangeRequest['status'];

export interface CanteenInput {
  name: string;
  slug?: string;
  location?: string | null;
  openingHours?: string | null;
  isActive?: boolean;
  isAcceptingOrders?: boolean;
}

export interface ServiceConfigInput {
  period: ServicePeriod;
  isEnabled: boolean;
  override: ScheduleOverride;
}

export interface PaymentConfigInput {
  mode?: 'DEMO' | 'LIVE';
  upiVpa?: string | null;
  merchantName?: string | null;
  qrImageUrl?: string | null;
  qrStorageKey?: string | null;
  instructions?: string | null;
  isActive?: boolean;
}

export interface StaffAssignmentsInput {
  primaryCanteenId: string;
  assignments: { canteenId: string; capabilities: StaffCapability[] }[];
}

export type StaffAssignmentsResult = StaffSummary & {
  canteenId: string | null;
  assignments: StaffAssignment[];
};

export type CanteenConfigResult = Canteen & {
  services: AdminCanteenService[];
  configurationWarnings: AdminCanteenDetail['configurationWarnings'];
};

/** Typed admin endpoints (`/api/admin/*`). Authorization is decided by the backend from PostgreSQL. */
export function adminApi(api: ApiClient) {
  const page = async <T>(path: string, query: Record<string, string | number | undefined | null>) =>
    (await api.request<Page<T>>('GET', path, { query })).body;

  return {
    dashboard: () => api.get<AdminDashboard>('/admin/dashboard'),

    canteens: () => api.get<AdminCanteen[]>('/admin/canteens'),
    browseCanteens: () => api.get<PublicCanteen[]>('/canteens'),
    canteen: (id: string) => api.get<AdminCanteenDetail>(`/admin/canteens/${id}`),
    liveCanteen: (id: string) => api.get<PublicCanteen>(`/canteens/${id}`),
    createCanteen: (body: CanteenInput) => api.data<Canteen>('POST', '/admin/canteens', { body }),
    updateCanteen: (id: string, body: Partial<CanteenInput>) =>
      api.data<Canteen>('PATCH', `/admin/canteens/${id}`, { body }),
    updateCanteenServices: (id: string, services: ServiceConfigInput[]) =>
      api.data<CanteenConfigResult>('PUT', `/admin/canteens/${id}/services`, { body: { services } }),
    updateCanteenSchedule: (
      id: string,
      period: ServicePeriod,
      schedules: AdminOperatingSchedule[],
    ) =>
      api.data<CanteenConfigResult>('PUT', `/admin/canteens/${id}/services/${period}/schedule`, {
        body: { schedules },
      }),
    paymentConfig: (id: string) =>
      api.get<CanteenPaymentConfig | null>(`/admin/canteens/${id}/payment-config`),
    updatePaymentConfig: (id: string, body: PaymentConfigInput) =>
      api.data<CanteenPaymentConfig>('PUT', `/admin/canteens/${id}/payment-config`, { body }),
    hostels: () => api.get<AdminHostel[]>('/admin/hostels'),

    menuCatalogue: (canteenId: string) =>
      api.get<AdminMenuCategory[]>(`/admin/canteens/${canteenId}/menu/catalogue`),
    updateMenuItemServices: (itemId: string, services: MenuItemServiceConfig[]) =>
      api.data<MenuItemServices>('PUT', `/admin/menu/items/${itemId}/services`, {
        body: { services },
      }),

    staff: (
      filters: {
        status?: StaffStatus | undefined;
        canteenId?: string | undefined;
        cursor?: string | null | undefined;
      } = {},
    ) =>
      page<StaffSummary>('/admin/staff', {
        limit: 50,
        status: filters.status,
        canteenId: filters.canteenId,
        cursor: filters.cursor,
      }),
    staffMember: (id: string) => api.get<StaffDetail>(`/admin/staff/${id}`),
    assignStaff: (id: string, canteenId: string) =>
      api.data<StaffSummary>('PATCH', `/admin/staff/${id}/assignment`, { body: { canteenId } }),
    updateStaffAssignments: (id: string, body: StaffAssignmentsInput) =>
      api.data<StaffAssignmentsResult>('PUT', `/admin/staff/${id}/assignments`, { body }),
    deactivateStaff: (id: string) =>
      api.data<StaffSummary>('POST', `/admin/staff/${id}/deactivate`),

    changeRequests: (status: ChangeRequestStatus | undefined, cursor?: string | null) =>
      page<ChangeRequest>('/admin/change-requests', { limit: 50, status, cursor }),
    approveRequest: (id: string, notes?: string) =>
      api.data<ChangeRequest>('POST', `/admin/change-requests/${id}/approve`, {
        body: notes ? { notes } : {},
      }),
    rejectRequest: (id: string, notes?: string) =>
      api.data<ChangeRequest>('POST', `/admin/change-requests/${id}/reject`, {
        body: notes ? { notes } : {},
      }),

    orders: (
      filters: {
        status?: OrderStatus | undefined;
        canteenId?: string | undefined;
        limit?: number;
      } = {},
    ) =>
      page<StaffOrder>('/admin/orders', {
        limit: filters.limit ?? 20,
        status: filters.status,
        canteenId: filters.canteenId,
      }),
  };
}

export type AdminApi = ReturnType<typeof adminApi>;
