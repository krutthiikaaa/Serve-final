import { z } from 'zod';

/**
 * Frozen frontend contract. Schemas are STRICT: an extra field (e.g. a leaked
 * firebaseUid or requestHash) fails the contract test just like a missing one.
 */
const isoDate = z.iso.datetime();
const uuid = z.uuid();
const paise = z.number().int().nonnegative();
const ref = z.strictObject({ id: uuid, name: z.string() });
const orderStatus = z.enum([
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
  canteen: canteenSchema,
  categories: z.array(categorySchema.extend({ items: z.array(menuItemSchema) })),
});

export const quoteSchema = z.strictObject({
  canteen: ref,
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

export const studentOrderSchema = z.strictObject({
  id: uuid,
  orderNumber: z.string().regex(/^SV\d+$/),
  status: orderStatus,
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
      provider: z.enum(['MOCK', 'RAZORPAY']),
      status: z.enum(['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED']),
      amountPaise: paise,
      currency: z.string(),
      paidAt: isoDate.nullable(),
      refundedAt: isoDate.nullable(),
      failureReason: z.string().nullable(),
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
  timeline: z.array(z.strictObject({ status: orderStatus, at: isoDate })),
});

export const staffOrderSchema = studentOrderSchema.extend({ student: ref });

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
export const meStaffSchema = z.strictObject({
  ...meBase,
  role: z.literal('STAFF'),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'DEACTIVATED']),
  canteen: canteenState.nullable(),
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
    createdByStatus: z.record(orderStatus, z.number()),
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
  z.strictObject({ order, previousStatus: orderStatus.nullable() });

/** Asserts a value matches a schema, with a readable failure. */
export function expectShape<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Contract mismatch:\n${z.prettifyError(result.error)}\nvalue: ${JSON.stringify(value, null, 2)}`,
    );
  }
  return result.data;
}
