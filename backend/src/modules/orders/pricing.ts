import type { Logger } from 'pino';
import type { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { systemClock } from '../../lib/time.js';
import {
  DEFAULT_SERVICE_PERIOD,
  assertServiceOpen,
  evaluateServiceAvailability,
  type ServicePeriod,
} from '../canteens/availability.js';

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
  servicePeriod: ServicePeriod;
  items: PricedLine[];
  /** Total number of units across all lines. */
  itemCount: number;
  /** Sum of line totals. */
  subtotalPaise: number;
  /** Amount payable. Equal to subtotal (no fees, no delivery). */
  totalPaise: number;
  currency: 'INR';
}

export type CartIssueReason = 'NOT_IN_CANTEEN' | 'INACTIVE' | 'UNAVAILABLE' | 'PERIOD_PRICE_MISSING';

export interface CartIssue {
  menuItemId: string;
  reason: CartIssueReason;
}

/** Upper bound for one order (₹10,00,000); also enforced by a CHECK constraint. */
export const MAX_ORDER_TOTAL_PAISE = 100_000_000;

export interface PriceCartOptions {
  servicePeriod?: ServicePeriod;
  now?: Date;
  logger?: Logger;
}

/**
 * Authoritative cart pricing. Prices come ONLY from PostgreSQL period rows;
 * any price, total or line total sent by a client is never read.
 *
 * Validates: canteen exists, the selected service is open, every item exists,
 * belongs to the canteen, is active, its category is active, it is available
 * for the period, and a MenuItemService price exists for that period.
 */
export async function priceCart(
  db: PrismaClient | Prisma.TransactionClient,
  canteenId: string,
  lines: CartLineInput[],
  options: PriceCartOptions = {},
): Promise<PricedCart> {
  const servicePeriod = options.servicePeriod ?? DEFAULT_SERVICE_PERIOD;
  const now = options.now ?? systemClock();
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
    select: {
      id: true,
      name: true,
      isActive: true,
      isAcceptingOrders: true,
      services: {
        where: { period: servicePeriod },
        select: {
          isEnabled: true,
          override: true,
          schedules: { select: { weekday: true, opensAtMinutes: true, closesAtMinutes: true } },
        },
      },
    },
  });
  if (!canteen) throw new NotFoundError('Canteen not found.', 'CANTEEN_NOT_FOUND');

  const service = canteen.services[0] ?? null;
  const availability = evaluateServiceAvailability({
    canteen,
    service,
    schedules: service?.schedules ?? [],
    now,
  });
  if (availability.warnings.length > 0) {
    options.logger?.warn(
      {
        canteenId,
        servicePeriod,
        code: availability.code,
        warnings: availability.warnings,
      },
      'Canteen service schedule is not usable; failing closed',
    );
  }
  assertServiceOpen(availability);

  const items = await db.menuItem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      canteenId: true,
      name: true,
      isAvailable: true,
      isActive: true,
      category: { select: { isActive: true } },
      services: {
        where: { period: servicePeriod },
        select: { pricePaise: true, isAvailable: true },
      },
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
    else if (!item.services[0]) issues.push({ menuItemId: id, reason: 'PERIOD_PRICE_MISSING' });
    else if (!item.isAvailable || !item.services[0].isAvailable)
      issues.push({ menuItemId: id, reason: 'UNAVAILABLE' });
  }
  if (issues.length > 0) {
    const missingPrice = issues.filter((issue) => issue.reason === 'PERIOD_PRICE_MISSING');
    if (missingPrice.length > 0) {
      throw new ConflictError(
        'A price is not configured for this service period.',
        'PERIOD_PRICE_NOT_CONFIGURED',
        { items: missingPrice },
      );
    }
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
    const unitPricePaise = item.services[0]!.pricePaise;
    return {
      menuItemId: item.id,
      itemName: item.name,
      unitPricePaise,
      quantity: line.quantity,
      lineTotalPaise: unitPricePaise * line.quantity,
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
    servicePeriod,
    items: priced,
    itemCount: priced.reduce((sum, line) => sum + line.quantity, 0),
    subtotalPaise,
    totalPaise: subtotalPaise,
    currency: 'INR',
  };
}
