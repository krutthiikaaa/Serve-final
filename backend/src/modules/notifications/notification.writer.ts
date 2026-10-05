import type { NotificationType, Prisma } from '../../generated/prisma/client.js';
import { rooms, type Outbox } from '../../realtime/events.js';

export type Recipient =
  { kind: 'student'; id: string } | { kind: 'staff'; id: string } | { kind: 'admin'; id: string };

export interface NotificationInput {
  type: NotificationType;
  title: string;
  message: string;
  orderId?: string;
  data?: Prisma.InputJsonValue;
}

type Tx = Prisma.TransactionClient;

const recipientColumn = (recipient: Recipient) =>
  recipient.kind === 'student'
    ? { studentId: recipient.id }
    : recipient.kind === 'staff'
      ? { staffId: recipient.id }
      : { adminId: recipient.id };

const recipientRoom = (recipient: Recipient) =>
  recipient.kind === 'student'
    ? rooms.student(recipient.id)
    : recipient.kind === 'staff'
      ? rooms.staff(recipient.id)
      : rooms.adminUser(recipient.id);

export const notificationSelect = {
  id: true,
  type: true,
  title: true,
  message: true,
  orderId: true,
  data: true,
  readAt: true,
  createdAt: true,
} as const;

/**
 * Persist notifications inside the caller's transaction and queue a
 * `notification:created` realtime event for each recipient (sent after commit).
 */
export async function writeNotifications(
  tx: Tx,
  outbox: Outbox,
  recipients: Recipient[],
  input: NotificationInput,
): Promise<void> {
  for (const recipient of recipients) {
    const notification = await tx.notification.create({
      data: {
        ...recipientColumn(recipient),
        type: input.type,
        title: input.title,
        message: input.message,
        orderId: input.orderId ?? null,
        ...(input.data !== undefined ? { data: input.data } : {}),
      },
      select: notificationSelect,
    });
    outbox.emit('notification:created', [recipientRoom(recipient)], { notification });
  }
}

/** Every active admin, for platform-level notifications. */
export async function activeAdminRecipients(tx: Tx): Promise<Recipient[]> {
  const admins = await tx.admin.findMany({ where: { isActive: true }, select: { id: true } });
  return admins.map((admin) => ({ kind: 'admin' as const, id: admin.id }));
}
