import type { Prisma } from '../../generated/prisma/client.js';
import { ConflictError } from '../../lib/errors.js';
import type { OrderWithDetails } from './order.dto.js';

export const UNIVERSITY_NAME = 'Vellore Institute of Technology';

export async function allocateReceiptNumber(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ nextval: bigint }>>`
    SELECT nextval('receipt_number_seq') AS nextval
  `;
  return `RC${rows[0]!.nextval}`;
}

export function toReceiptDto(order: OrderWithDetails) {
  if (
    !order.payment ||
    order.payment.status !== 'SUCCESS' ||
    !order.receiptNumber ||
    !order.paidAt
  ) {
    throw new ConflictError(
      'A receipt is available only after payment is confirmed.',
      'RECEIPT_NOT_AVAILABLE',
    );
  }
  return {
    receiptNumber: order.receiptNumber,
    orderNumber: order.orderNumber,
    pickupToken: order.channel === 'APP' ? order.orderNumber : null,
    channel: order.channel,
    universityName: UNIVERSITY_NAME,
    canteen: order.canteen,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    servicePeriod: order.servicePeriod,
    items: order.items.map((item) => ({
      itemName: item.itemName,
      quantity: item.quantity,
      unitPricePaise: item.unitPricePaise,
      lineTotalPaise: item.lineTotalPaise,
    })),
    totalPaise: order.totalPaise,
    currency: 'INR' as const,
    paymentMethod: order.payment.provider,
    paymentStatus: 'SUCCESS' as const,
    utr: order.payment.utr,
    studentName: order.student?.name ?? null,
    guestName: order.guestName,
    verifiedByName: order.payment.verifiedBy?.name ?? null,
    simulated: order.payment.isSimulated,
    notice: order.payment.isSimulated ? 'DEMO TRANSACTION — NO REAL PAYMENT' : null,
  };
}
