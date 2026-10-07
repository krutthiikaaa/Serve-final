import type { Prisma } from '../../generated/prisma/client.js';

export const orderInclude = {
  canteen: { select: { id: true, name: true } },
  student: { select: { id: true, name: true } },
  items: {
    select: {
      id: true,
      menuItemId: true,
      itemName: true,
      unitPricePaise: true,
      quantity: true,
      lineTotalPaise: true,
    },
    orderBy: { createdAt: 'asc' },
  },
  payment: {
    select: {
      provider: true,
      status: true,
      amountPaise: true,
      currency: true,
      paidAt: true,
      refundedAt: true,
      failureReason: true,
    },
  },
} satisfies Prisma.OrderInclude;

export type OrderWithDetails = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export type OrderAudience = 'student' | 'staff' | 'admin';

/** Statuses the order has actually reached, in order, with timestamps. */
export function orderTimeline(order: OrderWithDetails) {
  const steps: { status: string; at: Date | null }[] = [
    { status: 'PLACED', at: order.createdAt },
    { status: 'PAYMENT_CONFIRMED', at: order.paidAt },
    { status: 'PREPARING', at: order.preparingAt },
    { status: 'READY', at: order.readyAt },
    { status: 'COLLECTED', at: order.collectedAt },
    { status: 'CANCELLED', at: order.cancelledAt },
  ];
  return steps.filter((step): step is { status: string; at: Date } => step.at !== null);
}

/**
 * Order representation. Students see their own orders; staff and admins also
 * see who placed it (name only — no contact details).
 */
export function toOrderDto(order: OrderWithDetails, audience: OrderAudience) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    totalPaise: order.totalPaise,
    currency: 'INR',
    canteen: order.canteen,
    ...(audience === 'student' ? {} : { student: order.student }),
    items: order.items,
    payment: order.payment,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paidAt: order.paidAt,
    preparingAt: order.preparingAt,
    readyAt: order.readyAt,
    collectedAt: order.collectedAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    timeline: orderTimeline(order),
  };
}
