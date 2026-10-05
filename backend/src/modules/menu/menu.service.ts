import type { PrismaClient } from '../../lib/prisma.js';
import type { EventPublisher } from '../../realtime/events.js';
import { Outbox, rooms } from '../../realtime/events.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { canteenTakesOrders } from '../canteens/canteen.dto.js';
import {
  categorySelect,
  menuItemSelect,
  toCategoryDto,
  toMenuItemDto,
  type MenuItemRow,
} from './menu.dto.js';

/**
 * Menu management. Every operation is scoped to a canteen:
 *  - staff: the canteen comes from their PostgreSQL record (never the client)
 *  - admin: any canteen, chosen explicitly in the admin route
 * A resource outside the caller's scope is reported as 404.
 */
export type MenuScope = { canteenId: string } | { admin: true };

export interface CategoryInput {
  name: string;
  sortOrder?: number | undefined;
}
export interface CategoryPatch {
  name?: string | undefined;
  sortOrder?: number | undefined;
  isActive?: boolean | undefined;
}
export interface ItemInput {
  categoryId: string;
  name: string;
  description?: string | null | undefined;
  pricePaise: number;
  imageUrl?: string | null | undefined;
  isAvailable?: boolean | undefined;
}
export interface ItemPatch {
  categoryId?: string | undefined;
  name?: string | undefined;
  description?: string | null | undefined;
  pricePaise?: number | undefined;
  imageUrl?: string | null | undefined;
  isAvailable?: boolean | undefined;
  isActive?: boolean | undefined;
}

const inScope = (scope: MenuScope, canteenId: string) =>
  'admin' in scope || scope.canteenId === canteenId;

const menuRooms = (canteenId: string) => [rooms.canteenPublic(canteenId), rooms.canteen(canteenId)];

export function createMenuService(prisma: PrismaClient, events: EventPublisher) {
  async function canteenState(canteenId: string) {
    const canteen = await prisma.canteen.findUnique({
      where: { id: canteenId },
      select: { id: true, isActive: true, isAcceptingOrders: true },
    });
    if (!canteen) throw new NotFoundError('Canteen not found.', 'CANTEEN_NOT_FOUND');
    return canteen;
  }

  async function scopedCategory(scope: MenuScope, categoryId: string) {
    const category = await prisma.menuCategory.findUnique({
      where: { id: categoryId },
      select: categorySelect,
    });
    if (!category || !inScope(scope, category.canteenId)) {
      throw new NotFoundError('Category not found.', 'CATEGORY_NOT_FOUND');
    }
    return category;
  }

  async function scopedItem(scope: MenuScope, itemId: string) {
    const item = await prisma.menuItem.findUnique({
      where: { id: itemId },
      select: menuItemSelect,
    });
    if (!item || !inScope(scope, item.canteenId)) {
      throw new NotFoundError('Menu item not found.', 'MENU_ITEM_NOT_FOUND');
    }
    return item;
  }

  async function itemDto(item: MenuItemRow) {
    const [canteen, category] = await Promise.all([
      canteenState(item.canteenId),
      prisma.menuCategory.findUniqueOrThrow({
        where: { id: item.categoryId },
        select: { isActive: true },
      }),
    ]);
    return toMenuItemDto(item, {
      categoryActive: category.isActive,
      canteenTakesOrders: canteenTakesOrders(canteen),
    });
  }

  function conflictOnName(err: unknown, what: 'category' | 'item'): never {
    if (isUniqueViolation(err)) {
      throw new ConflictError(
        what === 'category'
          ? 'A category with this name already exists in this canteen.'
          : 'An item with this name already exists in this canteen.',
        what === 'category' ? 'CATEGORY_EXISTS' : 'MENU_ITEM_EXISTS',
      );
    }
    throw err;
  }

  return {
    /** Full menu for management, including inactive categories/items. */
    async managedMenu(canteenId: string) {
      const canteen = await canteenState(canteenId);
      const categories = await prisma.menuCategory.findMany({
        where: { canteenId },
        select: { ...categorySelect, items: { select: menuItemSelect, orderBy: { name: 'asc' } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      return categories.map(({ items, ...category }) => ({
        ...toCategoryDto(category),
        items: items.map((item) =>
          toMenuItemDto(item, {
            categoryActive: category.isActive,
            canteenTakesOrders: canteenTakesOrders(canteen),
          }),
        ),
      }));
    },

    async createCategory(canteenId: string, input: CategoryInput) {
      await canteenState(canteenId);
      let category;
      try {
        category = await prisma.menuCategory.create({
          data: { canteenId, name: input.name, sortOrder: input.sortOrder ?? 0 },
          select: categorySelect,
        });
      } catch (err) {
        conflictOnName(err, 'category');
      }
      const outbox = new Outbox();
      outbox.emit('menu:category_updated', menuRooms(canteenId), {
        category: toCategoryDto(category),
      });
      outbox.flush(events);
      return toCategoryDto(category);
    },

    async updateCategory(scope: MenuScope, categoryId: string, patch: CategoryPatch) {
      await scopedCategory(scope, categoryId);
      let category;
      try {
        category = await prisma.menuCategory.update({
          where: { id: categoryId },
          data: patch,
          select: categorySelect,
        });
      } catch (err) {
        conflictOnName(err, 'category');
      }
      const outbox = new Outbox();
      outbox.emit('menu:category_updated', menuRooms(category.canteenId), {
        category: toCategoryDto(category),
      });
      outbox.flush(events);
      return toCategoryDto(category);
    },

    async createItem(canteenId: string, input: ItemInput) {
      const category = await prisma.menuCategory.findUnique({ where: { id: input.categoryId } });
      if (!category || category.canteenId !== canteenId) {
        throw new ValidationError(
          'Choose a category from this canteen.',
          undefined,
          'INVALID_CATEGORY',
        );
      }
      let item;
      try {
        item = await prisma.menuItem.create({
          data: {
            canteenId,
            categoryId: category.id,
            name: input.name,
            description: input.description ?? null,
            pricePaise: input.pricePaise,
            imageUrl: input.imageUrl ?? null,
            isAvailable: input.isAvailable ?? true,
          },
          select: menuItemSelect,
        });
      } catch (err) {
        conflictOnName(err, 'item');
      }
      const dto = await itemDto(item);
      const outbox = new Outbox();
      outbox.emit('menu:item_updated', menuRooms(canteenId), { item: dto, change: 'created' });
      outbox.flush(events);
      return dto;
    },

    async updateItem(scope: MenuScope, itemId: string, patch: ItemPatch) {
      const before = await scopedItem(scope, itemId);
      if (patch.categoryId && patch.categoryId !== before.categoryId) {
        const category = await prisma.menuCategory.findUnique({ where: { id: patch.categoryId } });
        if (!category || category.canteenId !== before.canteenId) {
          throw new ValidationError(
            'Choose a category from this canteen.',
            undefined,
            'INVALID_CATEGORY',
          );
        }
      }
      let item;
      try {
        item = await prisma.menuItem.update({
          where: { id: itemId },
          data: patch,
          select: menuItemSelect,
        });
      } catch (err) {
        conflictOnName(err, 'item');
      }
      const dto = await itemDto(item);
      const targets = menuRooms(item.canteenId);
      const outbox = new Outbox();
      outbox.emit('menu:item_updated', targets, { item: dto, change: 'updated' });
      if (item.pricePaise !== before.pricePaise) {
        outbox.emit('menu:price_updated', targets, {
          itemId: item.id,
          canteenId: item.canteenId,
          pricePaise: item.pricePaise,
          previousPricePaise: before.pricePaise,
        });
      }
      if (item.isAvailable !== before.isAvailable || item.isActive !== before.isActive) {
        outbox.emit('menu:availability_updated', targets, {
          itemId: item.id,
          canteenId: item.canteenId,
          isAvailable: item.isAvailable,
          isActive: item.isActive,
          isOrderable: dto.isOrderable,
        });
      }
      outbox.flush(events);
      return dto;
    },
  };
}

export type MenuService = ReturnType<typeof createMenuService>;
