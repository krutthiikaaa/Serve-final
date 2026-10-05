export const menuItemSelect = {
  id: true,
  canteenId: true,
  categoryId: true,
  name: true,
  description: true,
  pricePaise: true,
  imageUrl: true,
  isAvailable: true,
  isActive: true,
  updatedAt: true,
} as const;

export interface MenuItemRow {
  id: string;
  canteenId: string;
  categoryId: string;
  name: string;
  description: string | null;
  pricePaise: number;
  imageUrl: string | null;
  isAvailable: boolean;
  isActive: boolean;
  updatedAt: Date;
}

export const categorySelect = {
  id: true,
  canteenId: true,
  name: true,
  sortOrder: true,
  isActive: true,
  updatedAt: true,
} as const;

export interface CategoryRow {
  id: string;
  canteenId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  updatedAt: Date;
}

/**
 * Item as clients see it. `isOrderable` combines item and canteen state, so UIs
 * can show unavailable items (disabled) without guessing; the server still
 * re-validates on every quote and order.
 */
export function toMenuItemDto(
  item: MenuItemRow,
  context: { categoryActive: boolean; canteenTakesOrders: boolean },
) {
  return {
    id: item.id,
    canteenId: item.canteenId,
    categoryId: item.categoryId,
    name: item.name,
    description: item.description,
    pricePaise: item.pricePaise,
    imageUrl: item.imageUrl,
    isAvailable: item.isAvailable,
    isActive: item.isActive,
    isOrderable:
      item.isActive && item.isAvailable && context.categoryActive && context.canteenTakesOrders,
    updatedAt: item.updatedAt,
  };
}

export function toCategoryDto(category: CategoryRow) {
  return {
    id: category.id,
    canteenId: category.canteenId,
    name: category.name,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    updatedAt: category.updatedAt,
  };
}
