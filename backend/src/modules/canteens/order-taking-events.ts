import type { PrismaClient } from '../../lib/prisma.js';
import { Outbox, rooms, type EventPublisher } from '../../realtime/events.js';
import { canteenSelect, orderTakingPayload } from './canteen.dto.js';

/**
 * Publish the current state of every canteen whose availability changed
 * (`canteen.status_changed`), plus one `service_area.updated` per affected
 * area. Used by admin switches, staff pause/resume and the scheduler, so all
 * three apps hear about a change the same way. Call after the commit.
 */
export async function publishOrderTaking(
  prisma: PrismaClient,
  events: EventPublisher,
  canteenIds: readonly string[],
) {
  if (canteenIds.length === 0) return;
  const canteens = await prisma.canteen.findMany({
    where: { id: { in: [...new Set(canteenIds)] } },
    select: canteenSelect,
  });
  const outbox = new Outbox();
  for (const canteen of canteens) {
    outbox.emit(
      'canteen.status_changed',
      [rooms.canteenPublic(canteen.id), rooms.canteen(canteen.id), rooms.admins()],
      orderTakingPayload(canteen),
    );
  }
  const areas = new Map(canteens.map((canteen) => [canteen.serviceAreaId, canteen.serviceArea]));
  for (const [serviceAreaId, area] of areas) {
    outbox.emit(
      'service_area.updated',
      [
        ...area.canteens.flatMap((row) => [rooms.canteenPublic(row.id), rooms.canteen(row.id)]),
        rooms.admins(),
      ],
      {
        serviceAreaId,
        openCanteenId:
          area.canteens.find((row) => row.isActive && row.isAcceptingOrders)?.id ?? null,
      },
    );
  }
  outbox.flush(events);
}
