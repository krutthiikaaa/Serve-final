import type { PrismaClient } from '../../lib/prisma.js';
import type { Clock } from '../../lib/time.js';
import { systemClock } from '../../lib/time.js';
import type { StudentPrincipal } from '../auth/principal.js';
import { DEFAULT_SERVICE_PERIOD } from '../canteens/availability.js';
import { serviceAvailability } from '../canteens/canteen.dto.js';
import type { CanteensService } from '../canteens/canteens.service.js';
import { menuItemSelect, toMenuItemDto } from '../menu/menu.dto.js';

const LIMIT = 4;
const POPULAR_WINDOW_DAYS = 30;
const COUNTED_STATUSES = ['PAYMENT_CONFIRMED', 'PREPARING', 'READY', 'COLLECTED'] as const;

const periodItemSelect = {
  ...menuItemSelect,
  services: {
    where: { period: DEFAULT_SERVICE_PERIOD },
    select: { pricePaise: true, isAvailable: true },
  },
} as const;

/**
 * Home-screen suggestions from real order history:
 *  1. MOST_ORDERED — the student's own most-ordered items at this canteen
 *  2. POPULAR      — most ordered by everyone at this canteen (last 30 days)
 *  3. MENU         — first available items when there is no history yet
 *
 * Prices are the NIGHT service prices (student day/night selection is later).
 */
export function createRecommendationsService(
  prisma: PrismaClient,
  canteens: CanteensService,
  clock: Clock = systemClock,
) {
  async function itemsByIds(ids: string[], canteenId: string) {
    if (ids.length === 0) return [];
    const items = await prisma.menuItem.findMany({
      where: {
        id: { in: ids },
        canteenId,
        isActive: true,
        isAvailable: true,
        category: { isActive: true },
        services: { some: { period: DEFAULT_SERVICE_PERIOD, isAvailable: true } },
      },
      select: periodItemSelect,
    });
    const order = new Map(ids.map((id, index) => [id, index]));
    return items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  async function topItemIds(canteenId: string, studentId?: string) {
    const since = new Date(Date.now() - POPULAR_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const rows = await prisma.orderItem.groupBy({
      by: ['menuItemId'],
      where: {
        menuItemId: { not: null },
        order: {
          canteenId,
          status: { in: [...COUNTED_STATUSES] },
          ...(studentId ? { studentId } : { createdAt: { gte: since } }),
        },
      },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: LIMIT * 2,
    });
    return rows.map((row) => row.menuItemId).filter((id): id is string => id !== null);
  }

  return {
    async forStudent(student: StudentPrincipal, canteenId: string) {
      const canteen = await canteens.visibleCanteen(student, canteenId);
      const night = canteen.services.find((service) => service.period === DEFAULT_SERVICE_PERIOD);
      const takesOrders = serviceAvailability(canteen, night, clock()).open;
      const dto = (items: Awaited<ReturnType<typeof itemsByIds>>) =>
        items
          .slice(0, LIMIT)
          .flatMap((item) => {
            const period = item.services[0];
            if (!period) return [];
            return [
              toMenuItemDto(
                {
                  ...item,
                  pricePaise: period.pricePaise,
                  isAvailable: item.isAvailable && period.isAvailable,
                },
                { categoryActive: true, canteenTakesOrders: takesOrders },
              ),
            ];
          });

      const mine = await itemsByIds(await topItemIds(canteenId, student.id), canteenId);
      if (mine.length > 0) return { basis: 'MOST_ORDERED' as const, items: dto(mine) };

      const popular = await itemsByIds(await topItemIds(canteenId), canteenId);
      if (popular.length > 0) return { basis: 'POPULAR' as const, items: dto(popular) };

      const fallback = await prisma.menuItem.findMany({
        where: {
          canteenId,
          isActive: true,
          isAvailable: true,
          category: { isActive: true },
          services: { some: { period: DEFAULT_SERVICE_PERIOD, isAvailable: true } },
        },
        select: periodItemSelect,
        orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
        take: LIMIT,
      });
      return { basis: 'MENU' as const, items: dto(fallback) };
    },
  };
}
