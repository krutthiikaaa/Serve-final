import type { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';

export interface CartLineInput {
  menuItemId: string;
  quantity: number;
}

export interface PricedLine {
  menuItemId: string;
  itemName: string;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
}

export interface PricedCart {
  canteen: { id: string; name: string };
  items: PricedLine[];
  /** Total number of units across all lines. */
  itemCount: number;
  /** Sum of line totals. */
  subtotalPaise: number;
  /** Amount payable. Equal to subtotal (no fees, no delivery). */
  totalPaise: number;
  currency: 'INR';
}

export type CartIssueReason = 'NOT_IN_CANTEEN' | 'INACTIVE' | 'UNAVAILABLE';

export interface CartIssue {
  menuItemId: string;
  reason: CartIssueReason;
}

/** Upper bound for one order (₹10,00,000); also enforced by a CHECK constraint. */
export const MAX_ORDER_TOTAL_PAISE = 100_000_000;

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

  const issues: CartIssue[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item || item.canteenId !== canteenId)
      issues.push({ menuItemId: id, reason: 'NOT_IN_CANTEEN' });
    else if (!item.isActive || !item.category.isActive)
      issues.push({ menuItemId: id, reason: 'INACTIVE' });
    else if (!item.isAvailable) issues.push({ menuItemId: id, reason: 'UNAVAILABLE' });
  }
  if (issues.length > 0) {
    // Every problem is reported at once so the client can fix the whole cart.
    const notOnMenu = issues.some((issue) => issue.reason === 'NOT_IN_CANTEEN');
    throw new ValidationError(
      notOnMenu
        ? 'Some items are not on this canteen’s menu.'
        : 'This item is currently unavailable.',
      { items: issues },
      notOnMenu ? 'ITEM_NOT_FOUND' : 'ITEM_UNAVAILABLE',
    );
  }

  const priced = lines.map((line) => {
    const item = byId.get(line.menuItemId)!;
    return {
      menuItemId: item.id,
      itemName: item.name,
      unitPricePaise: item.pricePaise,
      quantity: line.quantity,
      lineTotalPaise: item.pricePaise * line.quantity,
    };
  });
  const subtotalPaise = priced.reduce((sum, line) => sum + line.lineTotalPaise, 0);
  if (subtotalPaise > MAX_ORDER_TOTAL_PAISE) {
    throw new ValidationError(
      'This order is too large.',
      { maxTotalPaise: MAX_ORDER_TOTAL_PAISE },
      'ORDER_TOTAL_TOO_LARGE',
    );
  }
  return {
    canteen: { id: canteen.id, name: canteen.name },
    items: priced,
    itemCount: priced.reduce((sum, line) => sum + line.quantity, 0),
    subtotalPaise,
    totalPaise: subtotalPaise,
    currency: 'INR',
  };
}
