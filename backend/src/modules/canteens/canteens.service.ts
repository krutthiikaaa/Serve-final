import type { PrismaClient } from '../../lib/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import type { Principal } from '../auth/principal.js';
import { canteenSelect, canteenTakesOrders, toCanteenDto, type CanteenRow } from './canteen.dto.js';
import { categorySelect, menuItemSelect, toCategoryDto, toMenuItemDto } from '../menu/menu.dto.js';

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

export function createCanteensService(prisma: PrismaClient) {
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
      const canteens = await prisma.canteen.findMany({
        where: principal?.role === 'ADMIN' ? {} : { isActive: true },
        select: canteenSelect,
        orderBy: { name: 'asc' },
      });
      return canteens.map(toCanteenDto);
    },

    async get(principal: Principal | null, canteenId: string) {
      return toCanteenDto(await visibleCanteen(principal, canteenId));
    },

    /** Student-facing menu: active categories with their active items (one query). */
    async menu(principal: Principal | null, canteenId: string) {
      const canteen = await visibleCanteen(principal, canteenId);
      const takesOrders = canteenTakesOrders(canteen);
      const categories = await prisma.menuCategory.findMany({
        where: { canteenId, isActive: true },
        select: {
          ...categorySelect,
          items: { where: { isActive: true }, select: menuItemSelect, orderBy: { name: 'asc' } },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      return {
        canteen: toCanteenDto(canteen),
        categories: categories
          .filter((category) => category.items.length > 0)
          .map(({ items, ...category }) => ({
            ...toCategoryDto(category),
            items: items.map((item) =>
              toMenuItemDto(item, { categoryActive: true, canteenTakesOrders: takesOrders }),
            ),
          })),
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

    async item(principal: Principal | null, itemId: string) {
      const item = await prisma.menuItem.findUnique({
        where: { id: itemId },
        select: {
          ...menuItemSelect,
          category: { select: { id: true, name: true, isActive: true } },
          canteen: { select: canteenSelect },
        },
      });
      if (
        !item ||
        !item.isActive ||
        !item.category.isActive ||
        !canSeeCanteen(principal, item.canteen)
      ) {
        throw new NotFoundError('Menu item not found.', 'MENU_ITEM_NOT_FOUND');
      }
      const { category, canteen, ...row } = item;
      return {
        ...toMenuItemDto(row, {
          categoryActive: true,
          canteenTakesOrders: canteenTakesOrders(canteen),
        }),
        category: { id: category.id, name: category.name },
        canteen: toCanteenDto(canteen),
      };
    },
  };
}

export type CanteensService = ReturnType<typeof createCanteensService>;
