import type {
  Canteen,
  CanteenPaymentConfig,
  Category,
  CategoryWithItems,
  ChangeRequest,
  Me,
  Menu,
  MenuItem,
  OrderStatus,
  Page,
  Receipt,
  ServicePeriod,
  StaffDashboard,
  StaffOrder,
} from '@serve/contracts';
import type { ApiClient, Query } from '@serve/web-shared';

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

export interface WalkInSaleInput {
  servicePeriod: ServicePeriod;
  paymentMethod: 'CASH' | 'UPI';
  paymentReceived: true;
  guestName?: string | null;
  utr?: string | null;
  items: { menuItemId: string; quantity: number }[];
}

export interface SalesFilters {
  channel?: 'APP' | 'WALK_IN';
  method?: 'CASH' | 'UPI';
  period?: ServicePeriod;
  simulated?: boolean;
  from?: string;
  to?: string;
  cursor?: string | null;
}

/**
 * Typed staff endpoints. Operating canteen is sent as `canteenId` and validated
 * against the staff member's PostgreSQL assignments on the backend.
 */
export function staffApi(api: ApiClient, canteenId?: string | null) {
  const scoped = (query: Query = {}): Query => (canteenId ? { ...query, canteenId } : query);

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

    dashboard: () => api.get<StaffDashboard>('/staff/dashboard', scoped()),
    setAcceptingOrders: (isAcceptingOrders: boolean) =>
      api.data<Canteen>('PATCH', '/staff/canteen/status', {
        body: { isAcceptingOrders },
        query: scoped(),
      }),

    orders: async (status: BoardStatus, options: { limit?: number; cursor?: string | null } = {}) =>
      (
        await api.request<Page<StaffOrder>>('GET', '/staff/orders', {
          query: scoped({ status, limit: options.limit ?? 100, cursor: options.cursor }),
        })
      ).body,
    order: (id: string) => api.get<StaffOrder>(`/staff/orders/${id}`, scoped()),
    setOrderStatus: (id: string, status: StaffSettableStatus, reason?: string) =>
      api.data<StaffOrder>('PATCH', `/staff/orders/${id}/status`, {
        body: reason ? { status, reason } : { status },
        query: scoped(),
      }),

    menu: () => api.get<CategoryWithItems[]>('/staff/menu', scoped()),
    createCategory: (body: { name: string; sortOrder?: number }) =>
      api.data<Category>('POST', '/staff/menu/categories', { body, query: scoped() }),
    updateCategory: (id: string, body: { name?: string; sortOrder?: number; isActive?: boolean }) =>
      api.data<Category>('PATCH', `/staff/menu/categories/${id}`, { body, query: scoped() }),
    createItem: (body: ItemInput) =>
      api.data<MenuItem>('POST', '/staff/menu/items', { body, query: scoped() }),
    updateItem: (id: string, body: Partial<ItemInput> & { isActive?: boolean }) =>
      api.data<MenuItem>('PATCH', `/staff/menu/items/${id}`, { body, query: scoped() }),
    setAvailability: (id: string, isAvailable: boolean) =>
      api.data<MenuItem>('PATCH', `/staff/menu/items/${id}/availability`, {
        body: { isAvailable },
        query: scoped(),
      }),
    disableItem: (id: string) =>
      api.data<MenuItem>('DELETE', `/staff/menu/items/${id}`, { query: scoped() }),

    pendingPayments: async (options: { cursor?: string | null } = {}) =>
      (
        await api.request<Page<StaffOrder>>('GET', '/staff/payments/pending', {
          query: scoped({ limit: 50, cursor: options.cursor }),
        })
      ).body,
    confirmPayment: (id: string, body: { paymentReceived: true; utr?: string | null }) =>
      api.data<{ order: StaffOrder; receipt: Receipt }>('POST', `/staff/orders/${id}/confirm-payment`, {
        body,
        query: scoped(),
      }),
    confirmDemoPayment: (id: string, body: { simulatedPaymentReceived: true; utr?: string | null }) =>
      api.data<{ order: StaffOrder; receipt: Receipt }>(
        'POST',
        `/staff/orders/${id}/confirm-demo-payment`,
        { body, query: scoped() },
      ),
    rejectPayment: (id: string, reason?: string) =>
      api.data<StaffOrder>('POST', `/staff/orders/${id}/reject-payment`, {
        body: reason ? { reason } : {},
        query: scoped(),
      }),
    posMenu: (period: ServicePeriod) =>
      api.get<Menu>('/staff/pos/menu', scoped({ period })),
    paymentConfig: () =>
      api.get<CanteenPaymentConfig | null>('/staff/canteen/payment-config', scoped()),
    completeWalkIn: (body: WalkInSaleInput) =>
      api.data<{ order: StaffOrder; receipt: Receipt }>('POST', '/staff/pos/sales', {
        body,
        query: scoped(),
      }),
    completeDemoWalkIn: (body: Omit<WalkInSaleInput, 'paymentReceived'> & { simulatedPaymentReceived: true }) =>
      api.data<{ order: StaffOrder; receipt: Receipt }>('POST', '/staff/pos/demo-sales', {
        body,
        query: scoped(),
      }),
    sales: async (filters: SalesFilters = {}) => {
      const { simulated, ...rest } = filters;
      return (
        await api.request<Page<StaffOrder>>('GET', '/staff/sales', {
          query: scoped({
            limit: 50,
            ...rest,
            simulated: simulated === undefined ? undefined : simulated ? 'true' : 'false',
          }),
        })
      ).body;
    },
    receipt: (id: string) => api.get<Receipt>(`/staff/orders/${id}/receipt`, scoped()),
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
