import type {
  AdminCanteen,
  AdminCanteenDetail,
  AdminDashboard,
  AdminHostel,
  Canteen,
  ChangeRequest,
  OrderStatus,
  Page,
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

/** Typed admin endpoints (`/api/admin/*`). Authorization is decided by the backend from PostgreSQL. */
export function adminApi(api: ApiClient) {
  const page = async <T>(path: string, query: Record<string, string | number | undefined | null>) =>
    (await api.request<Page<T>>('GET', path, { query })).body;

  return {
    dashboard: () => api.get<AdminDashboard>('/admin/dashboard'),

    canteens: () => api.get<AdminCanteen[]>('/admin/canteens'),
    canteen: (id: string) => api.get<AdminCanteenDetail>(`/admin/canteens/${id}`),
    createCanteen: (body: CanteenInput) => api.data<Canteen>('POST', '/admin/canteens', { body }),
    updateCanteen: (id: string, body: Partial<CanteenInput>) =>
      api.data<Canteen>('PATCH', `/admin/canteens/${id}`, { body }),
    hostels: () => api.get<AdminHostel[]>('/admin/hostels'),

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
