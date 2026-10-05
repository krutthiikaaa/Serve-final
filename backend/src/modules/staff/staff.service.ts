import type { PrismaClient } from '../../lib/prisma.js';
import { ConflictError } from '../../lib/errors.js';
import { startOfIstDay } from '../../lib/time.js';
import { Outbox, rooms, type EventPublisher } from '../../realtime/events.js';
import type { ApprovedStaffPrincipal } from '../../middleware/auth.js';
import { canteenSelect, orderTakingPayload, toCanteenDto } from '../canteens/canteen.dto.js';

export function createStaffService(prisma: PrismaClient, events: EventPublisher) {
  return {
    /** Operational overview for the staff member's assigned canteen. */
    async dashboard(staff: ApprovedStaffPrincipal) {
      const canteenId = staff.canteenId;
      const since = startOfIstDay();
      const [canteen, byStatus, today] = await Promise.all([
        prisma.canteen.findUniqueOrThrow({ where: { id: canteenId }, select: canteenSelect }),
        prisma.order.groupBy({
          by: ['status'],
          where: { canteenId, status: { in: ['PAYMENT_CONFIRMED', 'PREPARING', 'READY'] } },
          _count: { _all: true },
        }),
        prisma.order.aggregate({
          where: { canteenId, paidAt: { gte: since }, status: { notIn: ['PLACED', 'CANCELLED'] } },
          _count: { _all: true },
          _sum: { totalPaise: true },
        }),
      ]);
      const count = (status: string) =>
        byStatus.find((row) => row.status === status)?._count._all ?? 0;
      const pending = count('PAYMENT_CONFIRMED');
      const preparing = count('PREPARING');
      const ready = count('READY');
      return {
        canteen: toCanteenDto(canteen),
        orders: { active: pending + preparing + ready, pending, preparing, ready },
        today: { since, orderCount: today._count._all, revenuePaise: today._sum.totalPaise ?? 0 },
      };
    },

    /** Pause/resume order taking for the staff member's own canteen. */
    async setAcceptingOrders(staff: ApprovedStaffPrincipal, isAcceptingOrders: boolean) {
      const current = await prisma.canteen.findUniqueOrThrow({ where: { id: staff.canteenId } });
      if (isAcceptingOrders && !current.isActive) {
        throw new ConflictError('This canteen is inactive. Contact an admin.', 'CANTEEN_INACTIVE');
      }
      const canteen = await prisma.canteen.update({
        where: { id: staff.canteenId },
        data: { isAcceptingOrders },
        select: canteenSelect,
      });
      const outbox = new Outbox();
      outbox.emit(
        'canteen:order_taking_updated',
        [rooms.canteenPublic(canteen.id), rooms.canteen(canteen.id), rooms.admins()],
        orderTakingPayload(canteen),
      );
      outbox.flush(events);
      return toCanteenDto(canteen);
    },
  };
}
