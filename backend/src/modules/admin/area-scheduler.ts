import type { Logger } from 'pino';
import type { PrismaClient } from '../../lib/prisma.js';
import { effectiveTarget, type AreaTarget } from '../canteens/area-schedule.js';
import { lockServiceArea, switchServiceArea } from '../canteens/service-areas.js';

/**
 * Backend Day/Night scheduler. Runs in the API process (no browser, no
 * device timer), on start-up and then every `intervalMs`.
 *
 * Each pass reconciles every area that has automatic switching or a manual
 * override:
 *   1. lock the area row (SELECT … FOR UPDATE), so passes from several
 *      processes and admin actions on the same area run one after another;
 *   2. clear an override that has expired;
 *   3. work out the canteen that should be on duty (override > schedule);
 *   4. switch only if that differs from the current state.
 *
 * Idempotent: a pass that finds nothing to change writes nothing and emits
 * nothing. After a restart the first pass restores the correct state.
 * Only `isAcceptingOrders` (on duty) changes; `isPaused` is never touched,
 * and existing orders are never modified.
 */

const scheduleSelect = {
  id: true,
  autoSwitchEnabled: true,
  timezone: true,
  dayOpensAtMinutes: true,
  dayClosesAtMinutes: true,
  nightOpensAtMinutes: true,
  nightClosesAtMinutes: true,
  overrideTarget: true,
  overrideUntil: true,
  overrideSetAt: true,
  canteens: { select: { id: true, type: true, isActive: true, isAcceptingOrders: true } },
} as const;

export const DEFAULT_SCHEDULER_INTERVAL_MS = 30_000;

export function createAreaScheduler(deps: {
  prisma: PrismaClient;
  logger: Logger;
  /** Publishes realtime state for canteens whose on-duty flag changed. */
  publish: (canteenIds: string[]) => Promise<void>;
  clock: () => Date;
}) {
  const { prisma, logger, publish, clock } = deps;
  let running = false;

  /** Reconcile one area. Returns the canteens whose state changed. */
  async function reconcileArea(serviceAreaId: string, now: Date = clock()): Promise<string[]> {
    const changed = await prisma.$transaction(async (tx) => {
      await lockServiceArea(tx, serviceAreaId);
      let area = await tx.serviceArea.findUniqueOrThrow({
        where: { id: serviceAreaId },
        select: scheduleSelect,
      });
      if (area.overrideTarget && area.overrideUntil && area.overrideUntil <= now) {
        area = await tx.serviceArea.update({
          where: { id: serviceAreaId },
          data: {
            overrideTarget: null,
            overrideUntil: null,
            overrideSetAt: null,
            overrideByAdminId: null,
          },
          select: scheduleSelect,
        });
      }
      const { target } = effectiveTarget(area, now);
      if (target === null) return [];
      const desired = canteenFor(area.canteens, target);
      const current =
        area.canteens.find((canteen) => canteen.isActive && canteen.isAcceptingOrders)?.id ?? null;
      if (desired === current) return [];
      return (await switchServiceArea(tx, serviceAreaId, desired)).changedCanteenIds;
    });
    if (changed.length > 0) {
      logger.info(
        { serviceAreaId, changed, at: now.toISOString() },
        'Area service switched by schedule',
      );
      await publish(changed);
    }
    return changed;
  }

  /** One pass over every area that is scheduled or overridden. */
  async function tick(now: Date = clock()) {
    if (running) return { areas: 0, changed: [] as string[] };
    running = true;
    try {
      const areas = await prisma.serviceArea.findMany({
        where: { OR: [{ autoSwitchEnabled: true }, { overrideTarget: { not: null } }] },
        select: { id: true },
      });
      const changed: string[] = [];
      for (const area of areas) {
        try {
          changed.push(...(await reconcileArea(area.id, now)));
        } catch (err) {
          // One bad area never stops the others; the next pass retries.
          logger.error({ err, serviceAreaId: area.id }, 'Scheduler pass failed for area');
        }
      }
      return { areas: areas.length, changed };
    } finally {
      running = false;
    }
  }

  /** Starts the periodic scheduler; returns a stop function. */
  function start(intervalMs = DEFAULT_SCHEDULER_INTERVAL_MS) {
    const run = () =>
      void tick().catch((err: unknown) => logger.error({ err }, 'Scheduler pass failed'));
    run();
    const timer = setInterval(run, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  return { reconcileArea, tick, start };
}

function canteenFor(
  canteens: { id: string; type: 'DAY' | 'NIGHT'; isActive: boolean }[],
  target: AreaTarget,
): string | null {
  if (target === 'NONE') return null;
  return canteens.find((canteen) => canteen.type === target && canteen.isActive)?.id ?? null;
}

export type AreaScheduler = ReturnType<typeof createAreaScheduler>;
