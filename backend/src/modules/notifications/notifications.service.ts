import type { PrismaClient } from '../../lib/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import { pageArgs, toPage, type Pagination } from '../../http/validation.js';
import type { Principal } from '../auth/principal.js';
import { notificationSelect } from './notification.writer.js';

/** The recipient column for the caller — derived from the database principal. */
const ownership = (principal: Principal) =>
  principal.role === 'STUDENT'
    ? { studentId: principal.id }
    : principal.role === 'STAFF'
      ? { staffId: principal.id }
      : { adminId: principal.id };

export function createNotificationsService(prisma: PrismaClient) {
  return {
    async list(principal: Principal, options: { unreadOnly: boolean; page: Pagination }) {
      const owner = ownership(principal);
      const [rows, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where: { ...owner, ...(options.unreadOnly ? { readAt: null } : {}) },
          select: notificationSelect,
          ...pageArgs(options.page),
        }),
        prisma.notification.count({ where: { ...owner, readAt: null } }),
      ]);
      return { ...toPage(rows, options.page), unreadCount };
    },

    async markRead(principal: Principal, notificationId: string) {
      const owner = ownership(principal);
      const existing = await prisma.notification.findFirst({
        where: { id: notificationId, ...owner },
      });
      if (!existing) throw new NotFoundError('Notification not found.', 'NOTIFICATION_NOT_FOUND');
      return prisma.notification.update({
        where: { id: existing.id },
        data: { readAt: existing.readAt ?? new Date() },
        select: notificationSelect,
      });
    },

    async markAllRead(principal: Principal) {
      const { count } = await prisma.notification.updateMany({
        where: { ...ownership(principal), readAt: null },
        data: { readAt: new Date() },
      });
      return { updated: count };
    },
  };
}
