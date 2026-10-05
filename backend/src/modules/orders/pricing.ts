import type { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';

export interface CartLineInput {
  menuItemId: string;
  quantity: number;
}

export interface PricedLine {
  menuItemId: string;
  name: string;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
}

export interface PricedCart {
  canteen: { id: string; name: string };
  items: PricedLine[];
  totalPaise: number;
  currency: 'INR';
}

/**
 * Authoritative cart pricing. Prices come ONLY from PostgreSQL; any price,
 * total or line total sent by a client is never read.
 *
 * Validates: canteen exists/active/accepting, every item exists, belongs to
 * the canteen, is active, its category is active, it is available, and
 * quantities are 1..20 (schema-validated before this point).
 */
export async function priceCart(
  db: PrismaClient | Prisma.TransactionClient,
  canteenId: string,
  lines: CartLineInput[],
): Promise<PricedCart> {
  const ids = lines.map((line) => line.menuItemId);
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError(
      'Each item may appear only once in the cart.',
      undefined,
      'DUPLICATE_ITEM',
    );
  }

  const canteen = await db.canteen.findUnique({
    where: { id: canteenId },
    select: { id: true, name: true, isActive: true, isAcceptingOrders: true },
  });
  if (!canteen) throw new NotFoundError('Canteen not found.', 'CANTEEN_NOT_FOUND');
  if (!canteen.isActive) {
    throw new ConflictError('This canteen is currently unavailable.', 'CANTEEN_INACTIVE');
  }
  if (!canteen.isAcceptingOrders) {
    throw new ConflictError(
      'This canteen is currently not accepting orders.',
      'CANTEEN_NOT_ACCEPTING_ORDERS',
    );
  }

  const items = await db.menuItem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      canteenId: true,
      name: true,
      pricePaise: true,
      isAvailable: true,
      isActive: true,
      category: { select: { isActive: true } },
    },
  });
  const byId = new Map(items.map((item) => [item.id, item]));

  const missing = ids.filter((id) => byId.get(id)?.canteenId !== canteenId);
  if (missing.length > 0) {
    throw new ValidationError(
      'Some items are not on this canteen’s menu.',
      { menuItemIds: missing },
      'ITEM_NOT_FOUND',
    );
  }
  const unavailable = ids.filter((id) => {
    const item = byId.get(id)!;
    return !item.isActive || !item.category.isActive || !item.isAvailable;
  });
  if (unavailable.length > 0) {
    throw new ValidationError(
      'This item is currently unavailable.',
      { menuItemIds: unavailable },
      'ITEM_UNAVAILABLE',
    );
  }

  const priced = lines.map((line) => {
    const item = byId.get(line.menuItemId)!;
    return {
      menuItemId: item.id,
      name: item.name,
      unitPricePaise: item.pricePaise,
      quantity: line.quantity,
      lineTotalPaise: item.pricePaise * line.quantity,
    };
  });
  return {
    canteen: { id: canteen.id, name: canteen.name },
    items: priced,
    totalPaise: priced.reduce((sum, line) => sum + line.lineTotalPaise, 0),
    currency: 'INR',
  };
}
