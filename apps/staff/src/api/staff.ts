import type {
  Canteen,
  Category,
  CategoryWithItems,
  ChangeRequest,
  Me,
  MenuItem,
  OrderStatus,
  Page,
  StaffDashboard,
  StaffOrder,
} from '@serve/contracts';
import type { ApiClient } from '@serve/web-shared';

export type BoardStatus = 'active' | Exclude<OrderStatus, 'PLACED'>;
export type StaffSettableStatus = 'PREPARING' | 'READY' | 'COLLECTED' | 'CANCELLED';

export interface ItemInput {
  categoryId: string;
  name: string;
  description?: string | null;
  pricePaise: number;
  imageUrl?: string | null;
  isAvailable?: boolean;
}

/** Typed staff endpoints. The canteen is never sent — the backend derives it from the account. */
export function staffApi(api: ApiClient) {
  return {
    registerStaff: (body: { name: string; email: string; requestedCanteenId?: string }) =>
      api.data<Me>('POST', '/auth/staff/register', { body }),
    canteens: () => api.get<Canteen[]>('/canteens'),
    requestAccess: (body: { requestedCanteenId: string; notes?: string }) =>
      api.data<ChangeRequest>('POST', '/staff/change-requests', { body }),
    changeRequests: async () =>
      (
        await api.request<Page<ChangeRequest>>('GET', '/staff/change-requests', {
          query: { limit: 20 },
        })
      ).body,

    dashboard: () => api.get<StaffDashboard>('/staff/dashboard'),
    setAcceptingOrders: (isAcceptingOrders: boolean) =>
      api.data<Canteen>('PATCH', '/staff/canteen/status', { body: { isAcceptingOrders } }),

    orders: async (status: BoardStatus, options: { limit?: number; cursor?: string | null } = {}) =>
      (
        await api.request<Page<StaffOrder>>('GET', '/staff/orders', {
          query: { status, limit: options.limit ?? 100, cursor: options.cursor },
        })
      ).body,
    order: (id: string) => api.get<StaffOrder>(`/staff/orders/${id}`),
    setOrderStatus: (id: string, status: StaffSettableStatus, reason?: string) =>
      api.data<StaffOrder>('PATCH', `/staff/orders/${id}/status`, {
        body: reason ? { status, reason } : { status },
      }),

    menu: () => api.get<CategoryWithItems[]>('/staff/menu'),
    createCategory: (body: { name: string; sortOrder?: number }) =>
      api.data<Category>('POST', '/staff/menu/categories', { body }),
    updateCategory: (id: string, body: { name?: string; sortOrder?: number; isActive?: boolean }) =>
      api.data<Category>('PATCH', `/staff/menu/categories/${id}`, { body }),
    createItem: (body: ItemInput) => api.data<MenuItem>('POST', '/staff/menu/items', { body }),
    updateItem: (id: string, body: Partial<ItemInput> & { isActive?: boolean }) =>
      api.data<MenuItem>('PATCH', `/staff/menu/items/${id}`, { body }),
    setAvailability: (id: string, isAvailable: boolean) =>
      api.data<MenuItem>('PATCH', `/staff/menu/items/${id}/availability`, {
        body: { isAvailable },
      }),
    disableItem: (id: string) => api.data<MenuItem>('DELETE', `/staff/menu/items/${id}`),
  };
}

export type StaffApi = ReturnType<typeof staffApi>;

/** The next forward step a staff member can take for an order. */
export const NEXT_STATUS: Partial<
  Record<OrderStatus, { status: StaffSettableStatus; label: string }>
> = {
  PAYMENT_CONFIRMED: { status: 'PREPARING', label: 'Start preparing' },
  PREPARING: { status: 'READY', label: 'Mark ready' },
  READY: { status: 'COLLECTED', label: 'Mark collected' },
};

/** Cancellation is allowed only before preparation starts (backend-enforced). */
export const canCancel = (status: OrderStatus) => status === 'PAYMENT_CONFIRMED';
