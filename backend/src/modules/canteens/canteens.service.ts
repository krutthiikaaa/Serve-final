import type { Logger } from 'pino';
import type { PrismaClient } from '../../lib/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { systemClock } from '../../lib/time.js';
import type { Principal } from '../auth/principal.js';
import { categorySelect, menuItemSelect, toCategoryDto, toMenuItemDto } from '../menu/menu.dto.js';
import {
  DEFAULT_SERVICE_PERIOD,
  type ServicePeriod,
} from './availability.js';
import {
  canteenSelect,
  serviceAvailability,
  toPublicCanteenDto,
  type CanteenRow,
} from './canteen.dto.js';
import { ensureDemoPaymentConfig, toStudentPaymentConfigDto } from './payment-config.js';

/**
 * Who may see a canteen:
 *  - admins: every canteen
 *  - staff: their assigned canteen (any state) and active canteens
 *  - students / unregistered users: active canteens only
 * Invisible canteens are reported as 404 (existence is not revealed).
 */
export function canSeeCanteen(
  principal: Principal | null,
  canteen: Pick<CanteenRow, 'id' | 'isActive'>,
) {
  if (canteen.isActive) return true;
  if (principal?.role === 'ADMIN') return true;
  return (
    principal?.role === 'STAFF' &&
    principal.status === 'APPROVED' &&
    principal.canteenId === canteen.id
  );
}

export function createCanteensService(
  prisma: PrismaClient,
  deps: { clock?: Clock; logger?: Logger } = {},
) {
  const clock = deps.clock ?? systemClock;

  function dto(canteen: CanteenRow, now = clock()) {
    const mapped = toPublicCanteenDto(canteen, now);
    if (mapped.configurationWarnings.length > 0) {
      deps.logger?.warn(
        { canteenId: canteen.id, warnings: mapped.configurationWarnings },
        'Canteen service schedule needs configuration',
      );
    }
    return mapped;
  }

  async function visibleCanteen(principal: Principal | null, canteenId: string) {
    const canteen = await prisma.canteen.findUnique({
      where: { id: canteenId },
      select: canteenSelect,
    });
    if (!canteen || !canSeeCanteen(principal, canteen)) {
      throw new NotFoundError('Canteen not found.', 'CANTEEN_NOT_FOUND');
    }
    return canteen;
  }

  return {
    visibleCanteen,

    async list(principal: Principal | null) {
      const now = clock();
      const canteens = await prisma.canteen.findMany({
        where: principal?.role === 'ADMIN' ? {} : { isActive: true },
        select: canteenSelect,
        orderBy: { name: 'asc' },
      });
      return canteens.map((canteen) => dto(canteen, now));
    },

    async get(principal: Principal | null, canteenId: string) {
      return dto(await visibleCanteen(principal, canteenId));
    },

    /** Student-facing menu: active categories with period-priced items (one query). */
    async menu(
      principal: Principal | null,
      canteenId: string,
      servicePeriod: ServicePeriod = DEFAULT_SERVICE_PERIOD,
    ) {
      const now = clock();
      const canteen = await visibleCanteen(principal, canteenId);
      const service = canteen.services.find((row) => row.period === servicePeriod);
      const availability = serviceAvailability(canteen, service, now);
      const categories = await prisma.menuCategory.findMany({
        where: { canteenId, isActive: true },
        select: {
          ...categorySelect,
          items: {
            where: { isActive: true, services: { some: { period: servicePeriod } } },
            select: {
              ...menuItemSelect,
              services: {
                where: { period: servicePeriod },
                select: { pricePaise: true, isAvailable: true },
              },
            },
            orderBy: { name: 'asc' },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      return {
        canteen: dto(canteen, now),
        servicePeriod,
        categories: categories
          .map(({ items, ...category }) => ({
            ...toCategoryDto(category),
            items: items
              .map((item) => {
                const period = item.services[0];
                if (!period) return null;
                return toMenuItemDto(
                  {
                    ...item,
                    pricePaise: period.pricePaise,
                    isAvailable: item.isAvailable && period.isAvailable,
                  },
                  { categoryActive: true, canteenTakesOrders: availability.open },
                );
              })
              .filter((item): item is NonNullable<typeof item> => item !== null),
          }))
          .filter((category) => category.items.length > 0),
      };
    },

    async categories(principal: Principal | null, canteenId: string) {
      await visibleCanteen(principal, canteenId);
      const categories = await prisma.menuCategory.findMany({
        where: { canteenId, isActive: true },
        select: { ...categorySelect, _count: { select: { items: { where: { isActive: true } } } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      return categories.map(({ _count, ...category }) => ({
        ...toCategoryDto(category),
        itemCount: _count.items,
      }));
    },

    async item(
      principal: Principal | null,
      itemId: string,
      servicePeriod: ServicePeriod = DEFAULT_SERVICE_PERIOD,
    ) {
      const now = clock();
      const item = await prisma.menuItem.findUnique({
        where: { id: itemId },
        select: {
          ...menuItemSelect,
          services: {
            where: { period: servicePeriod },
            select: { pricePaise: true, isAvailable: true },
          },
          category: { select: { id: true, name: true, isActive: true } },
          canteen: { select: canteenSelect },
        },
      });
      const period = item?.services[0];
      if (
        !item ||
        !period ||
        !item.isActive ||
        !item.category.isActive ||
        !canSeeCanteen(principal, item.canteen)
      ) {
        throw new NotFoundError('Menu item not found.', 'MENU_ITEM_NOT_FOUND');
      }
      const { category, canteen, ...row } = item;
      const availability = serviceAvailability(
        canteen,
        canteen.services.find((service) => service.period === servicePeriod),
        now,
      );
      return {
        ...toMenuItemDto(
          {
            ...row,
            pricePaise: period.pricePaise,
            isAvailable: row.isAvailable && period.isAvailable,
          },
          { categoryActive: true, canteenTakesOrders: availability.open },
        ),
        category: { id: category.id, name: category.name },
        canteen: dto(canteen, now),
        servicePeriod,
      };
    },

    async paymentConfig(principal: Principal | null, canteenId: string) {
      const canteen = await visibleCanteen(principal, canteenId);
      return toStudentPaymentConfigDto(await ensureDemoPaymentConfig(prisma, canteen.id));
    },
  };
}

export type CanteensService = ReturnType<typeof createCanteensService>;
