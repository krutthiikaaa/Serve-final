import type { Prisma, ServicePeriod } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import {
  effectiveTarget,
  nextScheduledTransition,
  type AreaScheduleFields,
} from './area-schedule.js';

/**
 * Day/Night availability for a service area.
 *
 * Invariant (enforced by PostgreSQL, index `Canteen_one_open_per_service_area`):
 * at most one canteen of a service area is active AND accepting orders.
 *
 * Every change to `isActive` / `isAcceptingOrders` goes through
 * `applyOrderTaking` or `switchServiceArea`, inside a transaction that first
 * locks the service-area row (`SELECT … FOR UPDATE`). Concurrent attempts in
 * the same area therefore run one after the other; the unique index is the
 * final safety net and its violation is reported as 409, never as a 500.
 *
 * Existing orders are never touched: availability only gates NEW quotes,
 * orders and payment sessions.
 */

type Tx = Prisma.TransactionClient | PrismaClient;

export const EXCLUSIVITY_INDEX = 'Canteen_one_open_per_service_area';

export const canteenTypeLabel = (type: ServicePeriod) => (type === 'DAY' ? 'Day' : 'Night');

export function serviceAreaConflict(open: { id: string; name: string; type: ServicePeriod }) {
  return new ConflictError(
    `${open.name} is currently taking orders for this area. Only one of the Day and Night canteens can take orders at a time.`,
    'SERVICE_AREA_CONFLICT',
    { openCanteen: { id: open.id, name: open.name, type: open.type } },
  );
}

/** Map a lost race on the exclusivity index to a 409. Re-throws anything else. */
export function rethrowExclusivity(err: unknown): never {
  if (isUniqueViolation(err, EXCLUSIVITY_INDEX)) {
    throw new ConflictError(
      'The other canteen of this area started taking orders at the same moment. Refresh and try again.',
      'SERVICE_AREA_CONFLICT',
    );
  }
  throw err;
}

/** Serialize availability changes within one service area. */
export async function lockServiceArea(tx: Tx, serviceAreaId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "ServiceArea" WHERE "id" = ${serviceAreaId}::uuid FOR UPDATE`;
  if (rows.length === 0)
    throw new NotFoundError('Service area not found.', 'SERVICE_AREA_NOT_FOUND');
}

export interface OrderTakingPatch {
  isActive?: boolean | undefined;
  isAcceptingOrders?: boolean | undefined;
}

export interface OrderTakingResult {
  canteenId: string;
  /** Every canteen whose isActive/isAcceptingOrders changed (for realtime). */
  changedCanteenIds: string[];
}

/**
 * Change one canteen's operational status / ordering availability.
 *
 * When the result would open this canteen while its sibling is open:
 *   - `switchSibling: true`  (admin "make this the active service"): the
 *     sibling stops taking orders in the same transaction;
 *   - otherwise: 409 SERVICE_AREA_CONFLICT and nothing changes.
 */
export async function applyOrderTaking(
  tx: Tx,
  canteenId: string,
  patch: OrderTakingPatch,
  options: { switchSibling?: boolean } = {},
): Promise<OrderTakingResult> {
  const current = await tx.canteen.findUnique({
    where: { id: canteenId },
    select: { id: true, serviceAreaId: true, isActive: true, isAcceptingOrders: true },
  });
  if (!current) throw new NotFoundError('Canteen not found.', 'CANTEEN_NOT_FOUND');
  await lockServiceArea(tx, current.serviceAreaId);
  // Re-read under the lock.
  const canteen = await tx.canteen.findUniqueOrThrow({
    where: { id: canteenId },
    select: { id: true, serviceAreaId: true, isActive: true, isAcceptingOrders: true },
  });

  const next = {
    isActive: patch.isActive ?? canteen.isActive,
    isAcceptingOrders: patch.isAcceptingOrders ?? canteen.isAcceptingOrders,
  };
  const changed: string[] = [];

  if (next.isActive && next.isAcceptingOrders) {
    const open = await tx.canteen.findFirst({
      where: {
        serviceAreaId: canteen.serviceAreaId,
        id: { not: canteen.id },
        isActive: true,
        isAcceptingOrders: true,
      },
      select: { id: true, name: true, type: true },
    });
    if (open) {
      if (!options.switchSibling) throw serviceAreaConflict(open);
      await tx.canteen.update({ where: { id: open.id }, data: { isAcceptingOrders: false } });
      changed.push(open.id);
    }
  }

  if (next.isActive !== canteen.isActive || next.isAcceptingOrders !== canteen.isAcceptingOrders) {
    try {
      await tx.canteen.update({ where: { id: canteen.id }, data: next });
    } catch (err) {
      rethrowExclusivity(err);
    }
    changed.push(canteen.id);
  }
  return { canteenId: canteen.id, changedCanteenIds: changed };
}

/**
 * Choose which canteen of an area takes orders: a canteen id, or null for
 * "neither". The chosen canteen must be active. All others stop taking orders
 * first, so the exclusivity index never sees two open rows.
 */
export async function switchServiceArea(
  tx: Tx,
  serviceAreaId: string,
  canteenId: string | null,
): Promise<{ changedCanteenIds: string[] }> {
  await lockServiceArea(tx, serviceAreaId);
  const canteens = await tx.canteen.findMany({
    where: { serviceAreaId },
    select: { id: true, name: true, isActive: true, isAcceptingOrders: true },
  });
  const target = canteenId ? canteens.find((row) => row.id === canteenId) : null;
  if (canteenId && !target) {
    throw new NotFoundError(
      'That canteen does not belong to this service area.',
      'CANTEEN_NOT_FOUND',
    );
  }
  if (target && !target.isActive) {
    throw new ConflictError(
      'Activate the canteen before making it the active service.',
      'CANTEEN_INACTIVE',
    );
  }
  const changed: string[] = [];
  for (const row of canteens) {
    if (row.id !== canteenId && row.isAcceptingOrders) {
      await tx.canteen.update({ where: { id: row.id }, data: { isAcceptingOrders: false } });
      changed.push(row.id);
    }
  }
  if (target && !target.isAcceptingOrders) {
    try {
      await tx.canteen.update({ where: { id: target.id }, data: { isAcceptingOrders: true } });
    } catch (err) {
      rethrowExclusivity(err);
    }
    changed.push(target.id);
  }
  return { changedCanteenIds: changed };
}

export const areaScheduleSelect = {
  autoSwitchEnabled: true,
  timezone: true,
  dayOpensAtMinutes: true,
  dayClosesAtMinutes: true,
  nightOpensAtMinutes: true,
  nightClosesAtMinutes: true,
  overrideTarget: true,
  overrideUntil: true,
  overrideSetAt: true,
} as const;

/**
 * Staff pause / resume of their own canteen.
 *
 * Pausing sets `isPaused` only: the canteen stays on duty for its area and
 * the schedule never lifts the pause. Resuming clears `isPaused`. When the
 * canteen is also off duty and was not paused, "resume" asks to go on duty,
 * which staff may do only for an area that is switched by hand:
 *   - the other canteen is serving       -> 409 SERVICE_AREA_CONFLICT
 *   - the area follows a schedule/override -> 409 CLOSED_BY_SCHEDULE
 *   - otherwise the canteen goes on duty (exclusivity enforced as always).
 */
export async function applyStaffPause(
  tx: Tx,
  canteenId: string,
  paused: boolean,
  now: Date,
): Promise<OrderTakingResult> {
  const current = await tx.canteen.findUnique({
    where: { id: canteenId },
    select: { serviceAreaId: true },
  });
  if (!current) throw new NotFoundError('Canteen not found.', 'CANTEEN_NOT_FOUND');
  await lockServiceArea(tx, current.serviceAreaId);
  const canteen = await tx.canteen.findUniqueOrThrow({
    where: { id: canteenId },
    select: {
      id: true,
      isActive: true,
      isAcceptingOrders: true,
      isPaused: true,
      serviceArea: { select: areaScheduleSelect },
    },
  });
  if (!paused && !canteen.isActive) {
    throw new ConflictError('This canteen is inactive. Contact an admin.', 'CANTEEN_INACTIVE');
  }
  const changed: string[] = [];
  if (canteen.isPaused !== paused) {
    await tx.canteen.update({ where: { id: canteenId }, data: { isPaused: paused } });
    changed.push(canteenId);
  }
  if (paused || canteen.isAcceptingOrders || canteen.isPaused) {
    return { canteenId, changedCanteenIds: changed };
  }
  // Not paused and off duty: the request is "start taking orders".
  const open = await tx.canteen.findFirst({
    where: {
      serviceAreaId: current.serviceAreaId,
      id: { not: canteenId },
      isActive: true,
      isAcceptingOrders: true,
    },
    select: { id: true, name: true, type: true },
  });
  if (open) throw serviceAreaConflict(open);
  if (effectiveTarget(canteen.serviceArea, now).mode !== 'MANUAL') {
    throw closedBySchedule(canteen.serviceArea, now);
  }
  const result = await applyOrderTaking(tx, canteenId, { isAcceptingOrders: true });
  return { canteenId, changedCanteenIds: [...new Set([...changed, ...result.changedCanteenIds])] };
}

export function closedBySchedule(area: AreaScheduleFields, now: Date) {
  const next = nextScheduledTransition(area, now);
  return new ConflictError(
    'This area follows its Day/Night schedule. An admin can change which canteen is serving.',
    'CLOSED_BY_SCHEDULE',
    { nextTransition: next ? { at: next.at.toISOString(), target: next.target } : null },
  );
}

/** Internal identifier from a display name. Never entered by an admin. */
export const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');

/** A unique slug for `table`, suffixing -2, -3 … on collision. */
export async function uniqueSlug(
  tx: Tx,
  table: 'canteen' | 'serviceArea',
  name: string,
  excludeId?: string,
): Promise<string> {
  const base = slugify(name) || (table === 'canteen' ? 'canteen' : 'area');
  for (let n = 1; n < 1000; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const where = { slug, ...(excludeId ? { id: { not: excludeId } } : {}) };
    const taken =
      table === 'canteen'
        ? await tx.canteen.count({ where })
        : await tx.serviceArea.count({ where });
    if (taken === 0) return slug;
  }
  throw new ConflictError('Could not generate an identifier for this name.', 'SLUG_UNAVAILABLE');
}

/**
 * The canteen a student of this area should see by default: the one taking
 * orders now, otherwise the active Night canteen, otherwise any active one.
 * Null only when the area has no canteen at all.
 */
export function defaultCanteenOf<
  T extends { id: string; type: ServicePeriod; isActive: boolean; isAcceptingOrders: boolean },
>(canteens: readonly T[]): T | null {
  return (
    canteens.find((row) => row.isActive && row.isAcceptingOrders) ??
    canteens.find((row) => row.isActive && row.type === 'NIGHT') ??
    canteens.find((row) => row.isActive) ??
    canteens[0] ??
    null
  );
}

export const areaCanteenSelect = {
  id: true,
  name: true,
  type: true,
  isActive: true,
  isAcceptingOrders: true,
  isPaused: true,
} as const;
