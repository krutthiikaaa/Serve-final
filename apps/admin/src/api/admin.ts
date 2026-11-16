import type {
  AdminCanteen,
  AdminCanteenDetail,
  AdminCanteenService,
  AdminDashboard,
  AdminHostel,
  AdminMenuCategory,
  AdminPaymentOverview,
  AdminReport,
  AdminSettings,
  AdminOperatingSchedule,
  Canteen,
  CanteenPaymentConfig,
  ChangeRequest,
  Category,
  MenuItem,
  MenuItemServiceConfig,
  MenuItemServices,
  OrderStatus,
  Page,
  PublicCanteen,
  QrOverview,
  ServiceArea,
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

/** No slug: the server generates internal identifiers. */
export interface CanteenInput {
  name: string;
  type: ServicePeriod;
  serviceAreaId?: string;
  serviceAreaName?: string;
  location?: string | null;
  openingHours?: string | null;
  isActive?: boolean;
  isAcceptingOrders?: boolean;
}

export type CanteenPatch = Partial<Omit<CanteenInput, 'serviceAreaName'>> & {
  /** Temporary pause; never changed by the schedule. */
  isPaused?: boolean;
};

/** How long a manual switch overrides automatic switching (ISO date = until then). */
export type OverrideUntil = 'NEXT_TRANSITION' | 'UNTIL_RESTORED' | (string & {});

export interface AreaScheduleInput {
  autoSwitchEnabled: boolean;
  timezone: string;
  day: { opensAt: string; closesAt: string } | null;
  night: { opensAt: string; closesAt: string } | null;
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
    paymentOverview: () => api.get<AdminPaymentOverview>('/admin/payments'),
    reports: (
      query: {
        from?: string;
        to?: string;
        canteenId?: string;
        servicePeriod?: ServicePeriod | '';
        channel?: 'APP' | 'WALK_IN' | '';
        paymentMethod?: 'CASH' | 'UPI' | '';
        paymentMode?: 'DEMO' | 'LIVE' | '';
      } = {},
    ) => api.get<AdminReport>('/admin/reports', query),
    settings: () => api.get<AdminSettings>('/admin/settings'),

    canteens: () => api.get<AdminCanteen[]>('/admin/canteens'),
    browseCanteens: () => api.get<PublicCanteen[]>('/canteens'),
    canteen: (id: string) => api.get<AdminCanteenDetail>(`/admin/canteens/${id}`),
    liveCanteen: (id: string) => api.get<PublicCanteen>(`/canteens/${id}`),
    createCanteen: (body: CanteenInput) => api.data<Canteen>('POST', '/admin/canteens', { body }),
    updateCanteen: (id: string, body: CanteenPatch) =>
      api.data<Canteen>('PATCH', `/admin/canteens/${id}`, { body }),
    updateCanteenServices: (id: string, services: ServiceConfigInput[]) =>
      api.data<CanteenConfigResult>('PUT', `/admin/canteens/${id}/services`, {
        body: { services },
      }),
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

    serviceAreas: () => api.get<ServiceArea[]>('/admin/service-areas'),
    createServiceArea: (name: string) =>
      api.data<ServiceArea>('POST', '/admin/service-areas', { body: { name } }),
    renameServiceArea: (id: string, name: string) =>
      api.data<ServiceArea>('PATCH', `/admin/service-areas/${id}`, { body: { name } }),
    /** The canteen taking orders for an area, or null for neither (Day/Night exclusivity). */
    setActiveService: (areaId: string, canteenId: string | null, until?: OverrideUntil) =>
      api.data<ServiceArea>('PUT', `/admin/service-areas/${areaId}/active-canteen`, {
        body: until === undefined ? { canteenId } : { canteenId, until },
      }),
    /** Day/Night hours and automatic switching; applied by the server at once. */
    updateAreaSchedule: (areaId: string, body: AreaScheduleInput) =>
      api.data<ServiceArea>('PUT', `/admin/service-areas/${areaId}/schedule`, { body }),
    /** End a manual override: the area follows its schedule again. */
    restoreAutomatic: (areaId: string) =>
      api.data<ServiceArea>('DELETE', `/admin/service-areas/${areaId}/override`),

    qr: (canteenId: string) => api.get<QrOverview>(`/admin/canteens/${canteenId}/qr`),
    uploadQr: (canteenId: string, file: Blob) =>
      api.data<QrOverview>('PUT', `/admin/canteens/${canteenId}/qr`, {
        file: { data: file, contentType: file.type },
      }),
    removeQr: (canteenId: string) =>
      api.data<QrOverview>('DELETE', `/admin/canteens/${canteenId}/qr`),
    /** Absolute URL of an API-relative image path (e.g. a QR). */
    assetUrl: (path: string) => api.assetUrl(path),

    menuCatalogue: (canteenId: string) =>
      api.get<AdminMenuCategory[]>(`/admin/canteens/${canteenId}/menu/catalogue`),
    createMenuCategory: (canteenId: string, body: { name: string; sortOrder?: number }) =>
      api.data<Category>('POST', `/admin/canteens/${canteenId}/menu/categories`, { body }),
    updateMenuCategory: (
      id: string,
      body: { name?: string; sortOrder?: number; isActive?: boolean },
    ) => api.data<Category>('PATCH', `/admin/menu/categories/${id}`, { body }),
    createMenuItem: (
      canteenId: string,
      body: {
        categoryId: string;
        name: string;
        description?: string | null;
        pricePaise: number;
        isAvailable?: boolean;
      },
    ) => api.data<MenuItem>('POST', `/admin/canteens/${canteenId}/menu/items`, { body }),
    updateMenuItem: (
      id: string,
      body: {
        categoryId?: string;
        name?: string;
        description?: string | null;
        pricePaise?: number;
        isAvailable?: boolean;
        isActive?: boolean;
      },
    ) => api.data<MenuItem>('PATCH', `/admin/menu/items/${id}`, { body }),
    updateMenuItemServices: (itemId: string, services: MenuItemServiceConfig[]) =>
      api.data<MenuItemServices>('PUT', `/admin/menu/items/${itemId}/services`, {
        body: { services },
      }),

    staff: (
      filters: {
        status?: StaffStatus | undefined;
        canteenId?: string | undefined;
        capability?: StaffCapability | undefined;
        cursor?: string | null | undefined;
      } = {},
    ) =>
      page<StaffSummary>('/admin/staff', {
        limit: 50,
        status: filters.status,
        canteenId: filters.canteenId,
        capability: filters.capability,
        cursor: filters.cursor,
      }),
    staffMember: (id: string) => api.get<StaffDetail>(`/admin/staff/${id}`),
    /** Make `id` the canteen's dedicated account. `replaceExisting` revokes the current one. */
    assignStaff: (id: string, canteenId: string, replaceExisting = false) =>
      api.data<StaffSummary>('PATCH', `/admin/staff/${id}/assignment`, {
        body: replaceExisting ? { canteenId, replaceExisting } : { canteenId },
      }),
    updateStaffAssignments: (id: string, body: StaffAssignmentsInput) =>
      api.data<StaffAssignmentsResult>('PUT', `/admin/staff/${id}/assignments`, { body }),
    deactivateStaff: (id: string) =>
      api.data<StaffSummary>('POST', `/admin/staff/${id}/deactivate`),

    changeRequests: (status: ChangeRequestStatus | undefined, cursor?: string | null) =>
      page<ChangeRequest>('/admin/change-requests', { limit: 50, status, cursor }),
    approveRequest: (id: string, notes?: string, replaceExisting = false) =>
      api.data<ChangeRequest>('POST', `/admin/change-requests/${id}/approve`, {
        body: { ...(notes ? { notes } : {}), ...(replaceExisting ? { replaceExisting } : {}) },
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
