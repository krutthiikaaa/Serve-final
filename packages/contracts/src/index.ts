import { z } from 'zod';

/**
 * SERVE frozen API contract — the single source of truth shared by:
 *  - backend/tests (the contract smoke test validates live responses against
 *    these schemas; an extra or missing field fails it), and
 *  - apps/staff + apps/admin (TypeScript types are inferred from them).
 * Schemas are STRICT on purpose.
 */
const isoDate = z.iso.datetime();
const uuid = z.uuid();
const paise = z.number().int().nonnegative();
const ref = z.strictObject({ id: uuid, name: z.string() });
export const orderStatusSchema = z.enum([
  'PLACED',
  'PAYMENT_CONFIRMED',
  'PREPARING',
  'READY',
  'COLLECTED',
  'CANCELLED',
]);

export const errorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().regex(/^[A-Z_]+$/),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});

export const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({ data: z.array(item), nextCursor: uuid.nullable() });

export const servicePeriodSchema = z.enum(['DAY', 'NIGHT']);
export const scheduleOverrideSchema = z.enum(['AUTO', 'FORCE_OPEN', 'FORCE_CLOSED']);
export const canteenServiceSchema = z.strictObject({
  period: servicePeriodSchema,
  isEnabled: z.boolean(),
  override: scheduleOverrideSchema,
  isOpenNow: z.boolean(),
});
export const configurationWarningSchema = z.strictObject({
  period: servicePeriodSchema,
  code: z.enum(['AUTO_WITHOUT_SCHEDULE', 'INVALID_SCHEDULE']),
});

export const canteenSchema = z.strictObject({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  location: z.string().nullable(),
  openingHours: z.string().nullable(),
  isActive: z.boolean(),
  isAcceptingOrders: z.boolean(),
  status: z.enum(['ACCEPTING_ORDERS', 'PAUSED', 'INACTIVE']),
});

/** Student-facing canteen (`GET /api/canteens`, menu). Extra service fields. */
export const publicCanteenSchema = canteenSchema.extend({
  supportedPeriods: z.array(servicePeriodSchema),
  services: z.array(canteenServiceSchema),
  configurationWarnings: z.array(configurationWarningSchema),
});

export const hostelSchema = z.strictObject({ id: uuid, name: z.string(), canteen: ref });

export const menuItemSchema = z.strictObject({
  id: uuid,
  canteenId: uuid,
  categoryId: uuid,
  name: z.string(),
  description: z.string().nullable(),
  pricePaise: paise,
  imageUrl: z.string().nullable(),
  isAvailable: z.boolean(),
  isActive: z.boolean(),
  availability: z.enum(['AVAILABLE', 'UNAVAILABLE', 'INACTIVE']),
  isOrderable: z.boolean(),
  updatedAt: isoDate,
});

export const categorySchema = z.strictObject({
  id: uuid,
  canteenId: uuid,
  name: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  updatedAt: isoDate,
});

export const menuSchema = z.strictObject({
  canteen: publicCanteenSchema,
  servicePeriod: servicePeriodSchema,
  categories: z.array(categorySchema.extend({ items: z.array(menuItemSchema) })),
});

export const menuItemServiceConfigSchema = z.strictObject({
  period: servicePeriodSchema,
  pricePaise: paise,
  isAvailable: z.boolean(),
});

/** Admin catalogue item (`GET /api/admin/canteens/:id/menu/catalogue`). */
export const adminMenuItemSchema = menuItemSchema.extend({
  services: z.array(menuItemServiceConfigSchema),
});
export const adminMenuCategorySchema = categorySchema.extend({
  items: z.array(adminMenuItemSchema),
});

export const quoteSchema = z.strictObject({
  canteen: ref,
  servicePeriod: servicePeriodSchema,
  items: z.array(
    z.strictObject({
      menuItemId: uuid,
      itemName: z.string(),
      unitPricePaise: paise,
      quantity: z.number().int().min(1).max(20),
      lineTotalPaise: paise,
    }),
  ),
  itemCount: z.number().int(),
  subtotalPaise: paise,
  totalPaise: paise,
  currency: z.literal('INR'),
});

export const orderChannelSchema = z.enum(['APP', 'WALK_IN']);
export const paymentProviderSchema = z.enum(['MOCK', 'RAZORPAY', 'UPI', 'CASH']);
export const paymentStatusSchema = z.enum(['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED']);

export const studentOrderSchema = z.strictObject({
  id: uuid,
  orderNumber: z.string().regex(/^SV\d+$/),
  receiptNumber: z.string().nullable(),
  channel: orderChannelSchema,
  guestName: z.string().nullable(),
  status: orderStatusSchema,
  servicePeriod: servicePeriodSchema.nullable().optional(),
  totalPaise: paise,
  currency: z.literal('INR'),
  canteen: ref,
  items: z.array(
    z.strictObject({
      id: uuid,
      menuItemId: uuid.nullable(),
      itemName: z.string(),
      unitPricePaise: paise,
      quantity: z.number().int(),
      lineTotalPaise: paise,
    }),
  ),
  payment: z
    .strictObject({
      provider: paymentProviderSchema,
      status: paymentStatusSchema,
      amountPaise: paise,
      currency: z.string(),
      utr: z.string().nullable(),
      verifiedAt: isoDate.nullable(),
      paidAt: isoDate.nullable(),
      refundedAt: isoDate.nullable(),
      failureReason: z.string().nullable(),
      isSimulated: z.boolean(),
    })
    .nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
  paidAt: isoDate.nullable(),
  preparingAt: isoDate.nullable(),
  readyAt: isoDate.nullable(),
  collectedAt: isoDate.nullable(),
  cancelledAt: isoDate.nullable(),
  cancelReason: z.string().nullable(),
  timeline: z.array(z.strictObject({ status: orderStatusSchema, at: isoDate })),
});

export const staffOrderSchema = studentOrderSchema.extend({ student: ref.nullable() });

export const receiptSchema = z.strictObject({
  receiptNumber: z.string(),
  orderNumber: z.string().regex(/^SV\d+$/),
  pickupToken: z.string().nullable(),
  channel: orderChannelSchema,
  universityName: z.string(),
  canteen: ref,
  createdAt: isoDate,
  paidAt: isoDate,
  servicePeriod: servicePeriodSchema.nullable(),
  items: z.array(
    z.strictObject({
      itemName: z.string(),
      quantity: z.number().int(),
      unitPricePaise: paise,
      lineTotalPaise: paise,
    }),
  ),
  totalPaise: paise,
  currency: z.literal('INR'),
  paymentMethod: paymentProviderSchema,
  paymentStatus: z.literal('SUCCESS'),
  utr: z.string().nullable(),
  studentName: z.string().nullable(),
  guestName: z.string().nullable(),
  verifiedByName: z.string().nullable(),
  simulated: z.boolean(),
  notice: z.string().nullable(),
});

export const notificationSchema = z.strictObject({
  id: uuid,
  type: z.string(),
  title: z.string(),
  message: z.string(),
  orderId: uuid.nullable(),
  data: z.unknown(),
  readAt: isoDate.nullable(),
  createdAt: isoDate,
});

const meBase = {
  registered: z.literal(true),
  id: uuid,
  firebaseUid: z.string(),
  name: z.string(),
  email: z.email(),
  isActive: z.boolean(),
};
const canteenState = z.strictObject({
  id: uuid,
  name: z.string(),
  isActive: z.boolean(),
  isAcceptingOrders: z.boolean(),
});
export const meUnregisteredSchema = z.strictObject({
  registered: z.literal(false),
  role: z.null(),
  firebaseUid: z.string(),
  email: z.string().nullable(),
});
export const meStudentSchema = z.strictObject({
  ...meBase,
  role: z.literal('STUDENT'),
  hostel: ref,
  defaultCanteen: canteenState,
});
export const staffCapabilitySchema = z.enum(['KITCHEN', 'MENU', 'PAUSE', 'CASHIER']);
export const staffMeAssignmentSchema = z.strictObject({
  canteenId: uuid,
  canteen: canteenState,
  capabilities: z.array(staffCapabilitySchema),
});

export const meStaffSchema = z.strictObject({
  ...meBase,
  role: z.literal('STAFF'),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'DEACTIVATED']),
  canteen: canteenState.nullable(),
  assignments: z.array(staffMeAssignmentSchema),
  pendingChangeRequest: z
    .strictObject({
      id: uuid,
      status: z.literal('PENDING'),
      createdAt: isoDate,
      requestedCanteen: ref,
    })
    .nullable(),
});
export const meAdminSchema = z.strictObject({ ...meBase, role: z.literal('ADMIN') });

export const ssoAudienceSchema = z.enum(['STAFF', 'ADMIN']);
export const ssoInitiateResultSchema = z.strictObject({
  redirectUrl: z.url(),
  expiresAt: isoDate,
});
export const ssoExchangeResultSchema = z.strictObject({
  customToken: z.string().min(1),
});

export const changeRequestSchema = z.strictObject({
  id: uuid,
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  notes: z.string().nullable(),
  reviewNotes: z.string().nullable(),
  staff: z.strictObject({ id: uuid, name: z.string(), email: z.email(), status: z.string() }),
  requestedCanteen: ref,
  fromCanteen: ref.nullable(),
  reviewedBy: ref.nullable(),
  reviewedAt: isoDate.nullable(),
  createdAt: isoDate,
});

export const staffDashboardSchema = z.strictObject({
  canteen: canteenSchema,
  orders: z.strictObject({
    active: z.number(),
    awaitingPreparation: z.number(),
    preparing: z.number(),
    ready: z.number(),
  }),
  pendingPayments: z.number(),
  today: z.strictObject({ since: isoDate, orderCount: z.number(), revenuePaise: paise }),
});

export const adminDashboardSchema = z.strictObject({
  canteens: z.strictObject({
    total: z.number(),
    active: z.number(),
    acceptingOrders: z.number(),
    paused: z.number(),
    inactive: z.number(),
  }),
  staff: z.strictObject({
    active: z.number(),
    pending: z.number(),
    rejected: z.number(),
    deactivated: z.number(),
  }),
  pendingChangeRequests: z.number(),
  orders: z.strictObject({
    active: z.number(),
    awaitingPreparation: z.number(),
    preparing: z.number(),
    ready: z.number(),
  }),
  today: z.strictObject({
    since: isoDate,
    orderCount: z.number(),
    revenuePaise: paise,
    createdByStatus: z.record(orderStatusSchema, z.number()),
  }),
});

export const staffSummarySchema = z.strictObject({
  id: uuid,
  name: z.string(),
  email: z.email(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'DEACTIVATED']),
  createdAt: isoDate,
  updatedAt: isoDate,
  canteen: ref.nullable(),
});

export const orderEventSchema = <T extends z.ZodType>(order: T) =>
  z.strictObject({ order, previousStatus: orderStatusSchema.nullable() });

// ---------------------------------------------------------------------------
// Inferred types (use these in clients; never hand-write DTOs)
// ---------------------------------------------------------------------------

export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type ApiErrorBody = z.infer<typeof errorSchema>;
export type Page<T> = { data: T[]; nextCursor: string | null };
export type ServicePeriod = z.infer<typeof servicePeriodSchema>;
export type ScheduleOverride = z.infer<typeof scheduleOverrideSchema>;
export type Canteen = z.infer<typeof canteenSchema>;
export type PublicCanteen = z.infer<typeof publicCanteenSchema>;
export type Hostel = z.infer<typeof hostelSchema>;
export type MenuItem = z.infer<typeof menuItemSchema>;
export type Category = z.infer<typeof categorySchema>;
export type CategoryWithItems = Category & { items: MenuItem[] };
export type Menu = z.infer<typeof menuSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type StudentOrder = z.infer<typeof studentOrderSchema>;
export type StaffOrder = z.infer<typeof staffOrderSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type NotificationPage = Page<Notification> & { unreadCount: number };
export type MeUnregistered = z.infer<typeof meUnregisteredSchema>;
export type MeStudent = z.infer<typeof meStudentSchema>;
export type MeStaff = z.infer<typeof meStaffSchema>;
export type MeAdmin = z.infer<typeof meAdminSchema>;
export type Me = MeUnregistered | MeStudent | MeStaff | MeAdmin;
export type StaffStatus = MeStaff['status'];
export type ChangeRequest = z.infer<typeof changeRequestSchema>;
export type StaffDashboard = z.infer<typeof staffDashboardSchema>;
export type AdminDashboard = z.infer<typeof adminDashboardSchema>;
export type StaffSummary = z.infer<typeof staffSummarySchema>;

/** Admin canteen list row (`GET /api/admin/canteens`). */
export type AdminCanteen = Canteen & {
  counts: { hostels: number; activeStaff: number; menuItems: number };
};

export type AdminOperatingSchedule = {
  weekday: number;
  opensAtMinutes: number;
  closesAtMinutes: number;
};

export type AdminCanteenService = {
  period: ServicePeriod;
  isEnabled: boolean;
  override: ScheduleOverride;
  schedules: AdminOperatingSchedule[];
};

export type AdminConfigurationWarningCode =
  | 'AUTO_WITHOUT_SCHEDULE'
  | 'INVALID_SCHEDULE'
  | 'SERVICE_WITHOUT_MENU_PRICES'
  | 'SERVICE_DISABLED'
  | 'PERIOD_SCHEDULE_OVERLAP';

export type AdminConfigurationWarning = {
  period: ServicePeriod | null;
  code: AdminConfigurationWarningCode;
};

/** Admin canteen details (`GET /api/admin/canteens/:id`). */
export type AdminCanteenDetail = Canteen & {
  hostels: { id: string; name: string; isActive: boolean }[];
  staff: { id: string; name: string; email: string; status: StaffStatus }[];
  menuSummary: {
    categories: number;
    items: number;
    availableItems: number;
    byCategory: {
      id: string;
      name: string;
      isActive: boolean;
      items: number;
      availableItems: number;
    }[];
  };
  services?: AdminCanteenService[];
  configurationWarnings?: AdminConfigurationWarning[];
};

export type StaffCapability = z.infer<typeof staffCapabilitySchema>;
export type OrderChannel = z.infer<typeof orderChannelSchema>;
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;
export type Receipt = z.infer<typeof receiptSchema>;

export type StaffAssignment = {
  canteenId: string;
  canteen: { id: string; name: string; isActive?: boolean; isAcceptingOrders?: boolean };
  capabilities: StaffCapability[];
};

/** Admin staff details (`GET /api/admin/staff/:id`). */
export type StaffDetail = StaffSummary & {
  canteenId?: string | null;
  assignments?: StaffAssignment[];
  changeRequests: {
    id: string;
    status: ChangeRequest['status'];
    notes: string | null;
    reviewNotes: string | null;
    reviewedAt: string | null;
    createdAt: string;
    requestedCanteen: { id: string; name: string };
    fromCanteen: { id: string; name: string } | null;
  }[];
};

export const paymentModeSchema = z.enum(['DEMO', 'LIVE']);
export const demoQrSchema = z.strictObject({
  payload: z.string(),
  svg: z.string(),
  warning: z.literal('DEMO ONLY — NOT PAYABLE'),
});
export const canteenPaymentConfigSchema = z.strictObject({
  canteenId: uuid,
  mode: paymentModeSchema,
  upiVpa: z.string().nullable(),
  merchantName: z.string().nullable(),
  qrImageUrl: z.string().nullable(),
  qrStorageKey: z.string().nullable().optional(),
  instructions: z.string().nullable(),
  isActive: z.boolean(),
  demoQr: demoQrSchema.nullable(),
  warnings: z.array(z.string()),
  updatedAt: isoDate,
});
/** Student checkout config. Never includes `qrStorageKey` or Admin-only fields. */
export const studentPaymentConfigSchema = canteenPaymentConfigSchema.omit({ qrStorageKey: true });
export type PaymentMode = z.infer<typeof paymentModeSchema>;
export type CanteenPaymentConfig = z.infer<typeof canteenPaymentConfigSchema>;
export type StudentPaymentConfig = z.infer<typeof studentPaymentConfigSchema>;

export type MenuItemServiceConfig = z.infer<typeof menuItemServiceConfigSchema>;

export type MenuItemServices = {
  id: string;
  canteenId: string;
  name: string;
  pricePaise: number;
  isAvailable: boolean;
  services: MenuItemServiceConfig[];
};

export type AdminMenuItem = z.infer<typeof adminMenuItemSchema>;
export type AdminMenuCategory = z.infer<typeof adminMenuCategorySchema>;

export type AdminHostel = {
  id: string;
  name: string;
  isActive: boolean;
  canteen: { id: string; name: string };
};

export type CartIssueReason = 'NOT_IN_CANTEEN' | 'INACTIVE' | 'UNAVAILABLE';

export type PaymentSession = {
  orderId: string;
  orderNumber: string;
  provider: PaymentProvider;
  providerOrderId: string;
  amountPaise: number;
  currency: string;
};

export type Recommendations = { basis: 'MOST_ORDERED' | 'POPULAR' | 'MENU'; items: MenuItem[] };

// ---------------------------------------------------------------------------
// Realtime (Socket.IO). Every server event: { type, occurredAt, data }.
// ---------------------------------------------------------------------------

export interface RealtimeEnvelope<T> {
  type: string;
  occurredAt: string;
  data: T;
}

export type OrderEventData<O> = { order: O; previousStatus: OrderStatus | null };
export type StaffAssignmentData = {
  staffId: string;
  status: StaffStatus;
  canteen?: { id: string; name: string };
};

export interface ServerEvents<O = StaffOrder> {
  'order.created': OrderEventData<O>;
  'order.payment_confirmed': OrderEventData<O>;
  'order.preparing': OrderEventData<O>;
  'order.ready': OrderEventData<O>;
  'order.collected': OrderEventData<O>;
  'order.cancelled': OrderEventData<O>;
  'menu.item_updated': { item: MenuItem; change: 'created' | 'updated' };
  'menu.item_price_changed': {
    itemId: string;
    canteenId: string;
    pricePaise: number;
    previousPricePaise: number;
  };
  'menu.item_availability_changed': {
    itemId: string;
    canteenId: string;
    isAvailable: boolean;
    isActive: boolean;
    availability: MenuItem['availability'];
    isOrderable: boolean;
  };
  'menu.category_updated': { category: Category };
  'canteen.status_changed': {
    canteenId: string;
    isActive: boolean;
    isAcceptingOrders: boolean;
    status: Canteen['status'];
  };
  'change_request.created': { changeRequest: ChangeRequest };
  'change_request.updated': { changeRequest: ChangeRequest };
  'staff.approved': StaffAssignmentData;
  'staff.rejected': StaffAssignmentData;
  'staff.canteen_assigned': StaffAssignmentData;
  'staff.deactivated': StaffAssignmentData;
  'notification.created': { notification: Notification };
  'auth.expired': { reason: 'TOKEN_EXPIRED' };
}

export type ServerEventName = keyof ServerEvents;

export const ORDER_EVENT_NAMES = [
  'order.created',
  'order.payment_confirmed',
  'order.preparing',
  'order.ready',
  'order.collected',
  'order.cancelled',
] as const satisfies readonly ServerEventName[];
