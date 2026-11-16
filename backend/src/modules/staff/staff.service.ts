import { applyStaffPause } from '../canteens/service-areas.js';
import { publishOrderTaking } from '../canteens/order-taking-events.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { startOfIstDay, systemClock, type Clock } from '../../lib/time.js';
import type { EventPublisher } from '../../realtime/events.js';
import type { ApprovedStaffPrincipal } from '../../middleware/auth.js';
import { canteenSelect, toCanteenDto } from '../canteens/canteen.dto.js';

export function createStaffService(
  prisma: PrismaClient,
  events: EventPublisher,
  clock: Clock = systemClock,
) {
  return {
    /** Operational overview for one assigned canteen. */
    async dashboard(_staff: ApprovedStaffPrincipal, canteenId: string) {
      const since = startOfIstDay();
      const [canteen, byStatus, today, pendingPayments] = await Promise.all([
        prisma.canteen.findUniqueOrThrow({ where: { id: canteenId }, select: canteenSelect }),
        prisma.order.groupBy({
          by: ['status'],
          where: {
            canteenId,
            channel: 'APP',
            status: { in: ['PAYMENT_CONFIRMED', 'PREPARING', 'READY'] },
          },
          _count: { _all: true },
        }),
        prisma.order.aggregate({
          where: {
            canteenId,
            paidAt: { gte: since },
            status: { notIn: ['PLACED', 'CANCELLED'] },
            payment: { status: 'SUCCESS', isSimulated: false },
          },
          _count: { _all: true },
          _sum: { totalPaise: true },
        }),
        prisma.order.count({
          where: { canteenId, channel: 'APP', status: 'PLACED', payment: { status: 'PENDING' } },
        }),
      ]);
      const count = (status: string) =>
        byStatus.find((row) => row.status === status)?._count._all ?? 0;
      const pending = count('PAYMENT_CONFIRMED');
      const preparing = count('PREPARING');
      const ready = count('READY');
      return {
        canteen: toCanteenDto(canteen),
        orders: {
          active: pending + preparing + ready,
          awaitingPreparation: pending,
          preparing,
          ready,
        },
        pendingPayments,
        today: { since, orderCount: today._count._all, revenuePaise: today._sum.totalPaise ?? 0 },
      };
    },

    /** Pause/resume order taking for an assigned canteen. */
    async setAcceptingOrders(
      _staff: ApprovedStaffPrincipal,
      canteenId: string,
      isAcceptingOrders: boolean,
    ) {
      // Staff pause/resume only their own canteen. A pause is never lifted by
      // the Day/Night schedule; only an admin chooses which canteen of an
      // area is on duty (see applyStaffPause).
      const now = clock();
      const result = await prisma.$transaction((tx) =>
        applyStaffPause(tx, canteenId, !isAcceptingOrders, now),
      );
      // Always echo this canteen's state, plus any sibling that changed.
      await publishOrderTaking(prisma, events, [canteenId, ...result.changedCanteenIds]);
      const canteen = await prisma.canteen.findUniqueOrThrow({
        where: { id: canteenId },
        select: canteenSelect,
      });
      return toCanteenDto(canteen, now);
    },
  };
}
