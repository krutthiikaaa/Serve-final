import type { Logger } from 'pino';
import type { Prisma, ServicePeriod, StaffStatus } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { startOfIstDay, systemClock, type Clock } from '../../lib/time.js';
import { Outbox, rooms, type EventPublisher } from '../../realtime/events.js';
import { pageArgs, toPage, type Pagination } from '../../http/validation.js';
import type { AdminPrincipal } from '../auth/principal.js';
import { writeNotifications } from '../notifications/notification.writer.js';
import { UNIVERSITY_NAME } from '../orders/receipt.js';
import { canteenAvailability, canteenSelect, toCanteenDto } from '../canteens/canteen.dto.js';
import { publishOrderTaking } from '../canteens/order-taking-events.js';
import {
  effectiveTarget,
  minutesToClock,
  nextScheduledTransition,
  overrideActive,
  scheduledTarget,
  validateAreaSchedule,
  type AreaScheduleInput,
} from '../canteens/area-schedule.js';
import { createAreaScheduler } from './area-scheduler.js';
import { officialDetailsReady } from '../canteens/payment-config.js';
import { adminPaymentOverview, adminReports, type AdminReportQuery } from './admin-reports.js';
import { collectAdminWarnings, createAdminConfigService } from './admin-config.js';
import { assignDedicatedAccount, listStaffAssignments } from '../staff/assignments.js';
import {
  applyOrderTaking,
  areaCanteenSelect,
  areaScheduleSelect,
  lockServiceArea,
  defaultCanteenOf,
  switchServiceArea,
  uniqueSlug,
} from '../canteens/service-areas.js';
import { createQrCodesService } from '../canteens/qr-codes.js';

export interface CanteenInput {
  name: string;
  type: ServicePeriod;
  /** Existing service area, or … */
  serviceAreaId?: string | undefined;
  /** … the name of a new service area created with the canteen. */
  serviceAreaName?: string | undefined;
  location?: string | null | undefined;
  openingHours?: string | null | undefined;
  isActive?: boolean | undefined;
  isAcceptingOrders?: boolean | undefined;
}
export interface CanteenPatch {
  name?: string | undefined;
  type?: ServicePeriod | undefined;
  serviceAreaId?: string | undefined;
  location?: string | null | undefined;
  openingHours?: string | null | undefined;
  isActive?: boolean | undefined;
  isAcceptingOrders?: boolean | undefined;
  isPaused?: boolean | undefined;
}

/**
 * How long an admin's manual choice overrides automatic switching:
 *   NEXT_TRANSITION  until the schedule next changes (the default)
 *   UNTIL_RESTORED   until an admin restores automatic switching
 *   a Date           until that instant
 */
export type OverrideUntil = 'NEXT_TRANSITION' | 'UNTIL_RESTORED' | Date;

const serviceAreaSelect = {
  id: true,
  name: true,
  ...areaScheduleSelect,
  hostels: { select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } },
  canteens: { select: canteenSelect, orderBy: { type: 'asc' } },
} satisfies Prisma.ServiceAreaSelect;

const hoursOf = (opens: number | null, closes: number | null) =>
  opens === null || closes === null
    ? null
    : { opensAt: minutesToClock(opens), closesAt: minutesToClock(closes) };

const staffSelect = {
  id: true,
  name: true,
  email: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  canteen: { select: { id: true, name: true } },
} satisfies Prisma.StaffSelect;

const hostelSelect = {
  id: true,
  name: true,
  isActive: true,
  serviceArea: { select: { id: true, name: true, canteens: { select: areaCanteenSelect } } },
} satisfies Prisma.HostelSelect;

function toHostelDto(row: Prisma.HostelGetPayload<{ select: typeof hostelSelect }>) {
  const current = defaultCanteenOf(row.serviceArea.canteens);
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    serviceArea: { id: row.serviceArea.id, name: row.serviceArea.name },
    /** The area canteen students of this hostel see now (null if the area has none). */
    canteen: current ? { id: current.id, name: current.name, type: current.type } : null,
  };
}

export function createAdminService(
  prisma: PrismaClient,
  events: EventPublisher,
  logger: Logger,
  clock: Clock = systemClock,
) {
  const publish = (canteenIds: readonly string[]) => publishOrderTaking(prisma, events, canteenIds);
  // Used to apply a schedule change at once; the periodic run is started by server.ts.
  const scheduler = createAreaScheduler({ prisma, logger, publish, clock });
  const resolveArea = (input: {
    serviceAreaId?: string | undefined;
    canteenId?: string | undefined;
  }) => resolveAreaWith(prisma, input);
  const config = createAdminConfigService(prisma, logger);
  const qr = createQrCodesService(prisma, events, logger);
  function canteenConflict(err: unknown): never {
    if (isUniqueViolation(err, 'Canteen_name_key'))
      throw new ConflictError('A canteen with this name already exists.', 'CANTEEN_NAME_TAKEN');
    if (isUniqueViolation(err, 'ServiceArea_name_key'))
      throw new ConflictError('A service area with this name already exists.', 'AREA_EXISTS');
    if (isUniqueViolation(err, 'Canteen_serviceAreaId_type_key'))
      throw new ConflictError(
        'This service area already has a canteen of that type.',
        'CANTEEN_TYPE_TAKEN',
      );
    throw err;
  }

  /** Publish the current state of every canteen whose availability changed. */
  const emitOrderTaking = publish;

  /**
   * Record an admin's manual on-duty choice for an area. With automatic
   * switching on it becomes an override (so the scheduler does not undo it);
   * with automatic switching off the choice simply stands.
   */
  async function recordManualChoice(
    tx: Prisma.TransactionClient,
    serviceAreaId: string,
    adminId: string,
    until: OverrideUntil,
    now: Date,
  ) {
    const area = await tx.serviceArea.findUniqueOrThrow({
      where: { id: serviceAreaId },
      select: {
        ...areaScheduleSelect,
        canteens: { select: { type: true, isActive: true, isAcceptingOrders: true } },
      },
    });
    const clear = {
      overrideTarget: null,
      overrideUntil: null,
      overrideSetAt: null,
      overrideByAdminId: null,
    };
    if (!area.autoSwitchEnabled) {
      if (area.overrideTarget)
        await tx.serviceArea.update({ where: { id: serviceAreaId }, data: clear });
      return;
    }
    const target =
      area.canteens.find((canteen) => canteen.isActive && canteen.isAcceptingOrders)?.type ??
      'NONE';
    let overrideUntil: Date | null;
    if (until === 'UNTIL_RESTORED') overrideUntil = null;
    else if (until === 'NEXT_TRANSITION') {
      // Same as the schedule until it next changes: nothing to override.
      if (target === scheduledTarget(area, now)) {
        await tx.serviceArea.update({ where: { id: serviceAreaId }, data: clear });
        return;
      }
      overrideUntil = nextScheduledTransition(area, now)?.at ?? null;
    } else {
      if (until.getTime() <= now.getTime()) {
        throw new ValidationError(
          'Choose an end time in the future.',
          [{ path: 'until', message: 'Choose an end time in the future.' }],
          'INVALID_OVERRIDE_UNTIL',
        );
      }
      overrideUntil = until;
    }
    await tx.serviceArea.update({
      where: { id: serviceAreaId },
      data: {
        overrideTarget: target,
        overrideUntil,
        overrideSetAt: now,
        overrideByAdminId: adminId,
      },
    });
  }

  async function loadServiceArea(serviceAreaId: string) {
    const area = await prisma.serviceArea.findUnique({
      where: { id: serviceAreaId },
      select: serviceAreaSelect,
    });
    if (!area) throw new NotFoundError('Service area not found.', 'SERVICE_AREA_NOT_FOUND');
    return toServiceAreaDto(area);
  }

  function toServiceAreaDto(
    area: Prisma.ServiceAreaGetPayload<{ select: typeof serviceAreaSelect }>,
  ) {
    const now = clock();
    const canteens = area.canteens.map((canteen) => toCanteenDto(canteen, now));
    const { mode } = effectiveTarget(area, now);
    const next = area.autoSwitchEnabled ? nextScheduledTransition(area, now) : null;
    return {
      id: area.id,
      name: area.name,
      hostels: area.hostels,
      canteens,
      openCanteenId:
        area.canteens.find((canteen) => canteen.isActive && canteen.isAcceptingOrders)?.id ?? null,
      schedule: {
        autoSwitchEnabled: area.autoSwitchEnabled,
        timezone: area.timezone,
        day: hoursOf(area.dayOpensAtMinutes, area.dayClosesAtMinutes),
        night: hoursOf(area.nightOpensAtMinutes, area.nightClosesAtMinutes),
      },
      /** AUTOMATIC: follows the schedule · MANUAL_OVERRIDE: admin override in force · MANUAL: switched by hand. */
      mode,
      scheduledTarget: area.autoSwitchEnabled ? scheduledTarget(area, now) : null,
      override:
        area.overrideTarget && overrideActive(area, now)
          ? {
              target: area.overrideTarget,
              until: area.overrideUntil?.toISOString() ?? null,
              setAt: (area.overrideSetAt ?? now).toISOString(),
            }
          : null,
      nextTransition: next ? { at: next.at.toISOString(), target: next.target } : null,
    };
  }

  return {
    ...config,
    ...qr,

    // ---------------------------------------------------------------------
    // Service areas (Day/Night exclusivity)
    // ---------------------------------------------------------------------
    async listServiceAreas() {
      const areas = await prisma.serviceArea.findMany({
        select: serviceAreaSelect,
        orderBy: { name: 'asc' },
      });
      return areas.map(toServiceAreaDto);
    },

    getServiceArea: loadServiceArea,

    async createServiceArea(admin: AdminPrincipal, input: { name: string }) {
      try {
        const area = await prisma.$transaction(async (tx) =>
          tx.serviceArea.create({
            data: { name: input.name, slug: await uniqueSlug(tx, 'serviceArea', input.name) },
          }),
        );
        writeAudit(logger, {
          actor: { role: 'ADMIN', id: admin.id },
          action: 'admin.service_area.created',
          target: { type: 'service-area', id: area.id },
          after: { name: area.name },
        });
        return loadServiceArea(area.id);
      } catch (err) {
        if (isUniqueViolation(err, 'ServiceArea_name_key'))
          throw new ConflictError('A service area with this name already exists.', 'AREA_EXISTS');
        throw err;
      }
    },

    async updateServiceArea(admin: AdminPrincipal, serviceAreaId: string, input: { name: string }) {
      await loadServiceArea(serviceAreaId);
      try {
        await prisma.serviceArea.update({
          where: { id: serviceAreaId },
          data: { name: input.name },
        });
      } catch (err) {
        if (isUniqueViolation(err, 'ServiceArea_name_key'))
          throw new ConflictError('A service area with this name already exists.', 'AREA_EXISTS');
        throw err;
      }
      writeAudit(logger, {
        actor: { role: 'ADMIN', id: admin.id },
        action: 'admin.service_area.updated',
        target: { type: 'service-area', id: serviceAreaId },
        after: { name: input.name },
      });
      return loadServiceArea(serviceAreaId);
    },

    /**
     * Choose the canteen that takes orders for an area (or null for neither).
     * The other canteen stops taking orders in the same transaction.
     */
    async setActiveService(
      admin: AdminPrincipal,
      serviceAreaId: string,
      canteenId: string | null,
      until: OverrideUntil = 'NEXT_TRANSITION',
    ) {
      const before = await loadServiceArea(serviceAreaId);
      const now = clock();
      const result = await prisma.$transaction(async (tx) => {
        const switched = await switchServiceArea(tx, serviceAreaId, canteenId);
        await recordManualChoice(tx, serviceAreaId, admin.id, until, now);
        return switched;
      });
      await emitOrderTaking(result.changedCanteenIds);
      const after = await loadServiceArea(serviceAreaId);
      writeAudit(logger, {
        actor: { role: 'ADMIN', id: admin.id },
        action: 'admin.service_area.active_service',
        target: { type: 'service-area', id: serviceAreaId },
        before: { openCanteenId: before.openCanteenId, mode: before.mode },
        after: { openCanteenId: canteenId, mode: after.mode, override: after.override },
      });
      return after;
    },

    /** Save an area's Day/Night hours and automatic switching; applied at once. */
    async updateAreaSchedule(
      admin: AdminPrincipal,
      serviceAreaId: string,
      input: AreaScheduleInput,
    ) {
      validateAreaSchedule(input);
      const before = await loadServiceArea(serviceAreaId);
      await prisma.$transaction(async (tx) => {
        await lockServiceArea(tx, serviceAreaId);
        await tx.serviceArea.update({
          where: { id: serviceAreaId },
          data: {
            ...input,
            // An override exists only alongside automatic switching.
            ...(input.autoSwitchEnabled
              ? {}
              : {
                  overrideTarget: null,
                  overrideUntil: null,
                  overrideSetAt: null,
                  overrideByAdminId: null,
                }),
          },
        });
      });
      if (input.autoSwitchEnabled) await scheduler.reconcileArea(serviceAreaId, clock());
      const after = await loadServiceArea(serviceAreaId);
      writeAudit(logger, {
        actor: { role: 'ADMIN', id: admin.id },
        action: 'admin.service_area.schedule_updated',
        target: { type: 'service-area', id: serviceAreaId },
        before: { schedule: before.schedule, openCanteenId: before.openCanteenId },
        after: { schedule: after.schedule, openCanteenId: after.openCanteenId },
      });
      return after;
    },

    /** End a manual override: the area follows its schedule again, at once. */
    async restoreAutomatic(admin: AdminPrincipal, serviceAreaId: string) {
      const before = await loadServiceArea(serviceAreaId);
      await prisma.$transaction(async (tx) => {
        await lockServiceArea(tx, serviceAreaId);
        await tx.serviceArea.update({
          where: { id: serviceAreaId },
          data: {
            overrideTarget: null,
            overrideUntil: null,
            overrideSetAt: null,
            overrideByAdminId: null,
          },
        });
      });
      await scheduler.reconcileArea(serviceAreaId, clock());
      const after = await loadServiceArea(serviceAreaId);
      writeAudit(logger, {
        actor: { role: 'ADMIN', id: admin.id },
        action: 'admin.service_area.override_cleared',
        target: { type: 'service-area', id: serviceAreaId },
        before: { override: before.override, openCanteenId: before.openCanteenId },
        after: { mode: after.mode, openCanteenId: after.openCanteenId },
      });
      return after;
    },

    /** Platform overview, computed from live data (one round of parallel aggregate queries). */
    async dashboard() {
      const since = startOfIstDay();
      const realPayment = {
        status: 'SUCCESS' as const,
        isSimulated: false,
        refundedAt: null,
      };
      const [
        canteenRows,
        pendingRequests,
        staffByStatus,
        activeOrders,
        today,
        todayByStatus,
        todayByChannel,
        cashiers,
        assignmentCount,
      ] = await Promise.all([
        prisma.canteen.findMany({
          select: {
            ...canteenSelect,
            qrCodes: { where: { isActive: true }, select: { id: true } },
            paymentConfig: {
              select: {
                mode: true,
                upiVpa: true,
                merchantName: true,
                qrImageUrl: true,
                qrStorageKey: true,
              },
            },
          },
          orderBy: { name: 'asc' },
        }),
        prisma.canteenChangeRequest.count({ where: { status: 'PENDING' } }),
        prisma.staff.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.order.groupBy({
          by: ['status'],
          where: { status: { in: ['PAYMENT_CONFIRMED', 'PREPARING', 'READY'] } },
          _count: { _all: true },
        }),
        prisma.order.aggregate({
          where: {
            paidAt: { gte: since },
            status: { notIn: ['PLACED', 'CANCELLED'] },
            payment: realPayment,
          },
          _count: { _all: true },
          _sum: { totalPaise: true },
        }),
        prisma.order.groupBy({
          by: ['status'],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
        prisma.order.groupBy({
          by: ['channel'],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
        prisma.staff.count({
          where: {
            status: 'APPROVED',
            assignments: { some: { capabilities: { some: { capability: 'CASHIER' } } } },
          },
        }),
        prisma.staffCanteenAssignment.count(),
      ]);
      const staffCount = (status: StaffStatus) =>
        staffByStatus.find((row) => row.status === status)?._count._all ?? 0;
      const activeCount = (status: string) =>
        activeOrders.find((row) => row.status === status)?._count._all ?? 0;
      const placedToday = Object.fromEntries(
        (
          ['PLACED', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED'] as const
        ).map((status) => [
          status,
          todayByStatus.find((row) => row.status === status)?._count._all ?? 0,
        ]),
      );
      const channelCount = (channel: 'APP' | 'WALK_IN') =>
        todayByChannel.find((row) => row.channel === channel)?._count._all ?? 0;
      const now = new Date();
      const overview = canteenRows.map((canteen) => ({
        canteen,
        availability: canteenAvailability(canteen, now),
      }));
      let demo = 0;
      let live = 0;
      let incompleteLive = 0;
      for (const canteen of canteenRows) {
        const config = canteen.paymentConfig;
        if (!config) continue;
        if (config.mode === 'DEMO') demo += 1;
        if (config.mode === 'LIVE') {
          live += 1;
          if (!officialDetailsReady(config)) incompleteLive += 1;
        }
      }
      return {
        canteens: {
          total: canteenRows.length,
          active: canteenRows.filter((c) => c.isActive).length,
          acceptingOrders: canteenRows.filter(
            (c) => c.isActive && c.isAcceptingOrders && !c.isPaused,
          ).length,
          paused: canteenRows.filter((c) => c.isActive && c.isAcceptingOrders && c.isPaused).length,
          offDuty: canteenRows.filter((c) => c.isActive && !c.isAcceptingOrders).length,
          inactive: canteenRows.filter((c) => !c.isActive).length,
        },
        services: {
          day: canteenRows.filter((canteen) => canteen.type === 'DAY').length,
          night: canteenRows.filter((canteen) => canteen.type === 'NIGHT').length,
          openNow: overview.filter((row) => row.availability.isOpenNow).length,
          serviceAreas: new Set(canteenRows.map((canteen) => canteen.serviceAreaId)).size,
        },
        staff: {
          active: staffCount('APPROVED'),
          pending: staffCount('PENDING'),
          rejected: staffCount('REJECTED'),
          deactivated: staffCount('DEACTIVATED'),
          cashiers,
          assignments: assignmentCount,
        },
        payments: { demo, live, incompleteLive },
        canteenOverview: overview.map(({ canteen, availability }) => ({
          id: canteen.id,
          name: canteen.name,
          type: canteen.type,
          serviceArea: { id: canteen.serviceArea.id, name: canteen.serviceArea.name },
          isActive: canteen.isActive,
          isAcceptingOrders: canteen.isAcceptingOrders,
          isPaused: canteen.isPaused,
          state: availability.state,
          isOpenNow: availability.isOpenNow,
          paymentMode: canteen.paymentConfig?.mode ?? 'DEMO',
          qrUploaded: canteen.qrCodes.length > 0,
        })),
        pendingChangeRequests: pendingRequests,
        orders: {
          active:
            activeCount('PAYMENT_CONFIRMED') + activeCount('PREPARING') + activeCount('READY'),
          awaitingPreparation: activeCount('PAYMENT_CONFIRMED'),
          preparing: activeCount('PREPARING'),
          ready: activeCount('READY'),
        },
        today: {
          since,
          /** Successful LIVE payments today, excluding simulated and refunded payments. */
          orderCount: today._count._all,
          revenuePaise: today._sum.totalPaise ?? 0,
          appOrderCount: channelCount('APP'),
          walkInOrderCount: channelCount('WALK_IN'),
          /** Orders created today, by current status. */
          createdByStatus: placedToday,
        },
      };
    },

    paymentOverview: () => adminPaymentOverview(prisma),

    reports: (query: AdminReportQuery) => adminReports(prisma, query),

    settings: () => ({
      universityName: UNIVERSITY_NAME,
      timezone: 'Asia/Kolkata' as const,
      contact: null,
    }),

    async listCanteens() {
      const canteens = await prisma.canteen.findMany({
        select: {
          ...canteenSelect,
          _count: {
            select: {
              hostels: true,
              staff: { where: { status: 'APPROVED' } },
              menuItems: { where: { isActive: true } },
            },
          },
        },
        orderBy: { name: 'asc' },
      });
      const accounts = await prisma.staff.findMany({
        where: { status: 'APPROVED', canteenId: { not: null } },
        select: { id: true, name: true, email: true, canteenId: true },
      });
      const now = new Date();
      return canteens.map(({ _count, ...canteen }) => {
        const account = accounts.find((row) => row.canteenId === canteen.id);
        return {
          ...toCanteenDto(canteen, now),
          counts: {
            hostels: _count.hostels,
            activeStaff: _count.staff,
            menuItems: _count.menuItems,
          },
          staffAccount: account
            ? { id: account.id, name: account.name, email: account.email }
            : null,
        };
      });
    },

    async getCanteen(canteenId: string) {
      const canteen = await prisma.canteen.findUnique({
        where: { id: canteenId },
        select: {
          ...canteenSelect,
          serviceArea: {
            select: {
              ...canteenSelect.serviceArea.select,
              hostels: {
                select: { id: true, name: true, isActive: true },
                orderBy: { name: 'asc' },
              },
            },
          },
          staff: {
            select: { id: true, name: true, email: true, status: true },
            orderBy: { name: 'asc' },
          },
          categories: {
            select: {
              id: true,
              name: true,
              isActive: true,
              _count: { select: { items: true } },
              items: { where: { isActive: true, isAvailable: true }, select: { id: true } },
            },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          },
        },
      });
      if (!canteen) throw new NotFoundError('Canteen not found.', 'CANTEEN_NOT_FOUND');
      const { staff, categories, ...base } = canteen;
      // Hostels are served by the service area (both its Day and Night canteen).
      const hostels = canteen.serviceArea.hostels;
      return {
        ...toCanteenDto(base),
        services: (canteen.services ?? []).map((service) => ({
          period: service.period,
          isEnabled: service.isEnabled,
          override: service.override,
          schedules: service.schedules,
        })),
        configurationWarnings: await collectAdminWarnings(prisma, base),
        hostels,
        staff,
        menuSummary: {
          categories: categories.length,
          items: categories.reduce((sum, c) => sum + c._count.items, 0),
          availableItems: categories.reduce((sum, c) => sum + c.items.length, 0),
          byCategory: categories.map((c) => ({
            id: c.id,
            name: c.name,
            isActive: c.isActive,
            items: c._count.items,
            availableItems: c.items.length,
          })),
        },
      };
    },

    async createCanteen(admin: AdminPrincipal, input: CanteenInput) {
      if (Boolean(input.serviceAreaId) === Boolean(input.serviceAreaName)) {
        throw new ValidationError(
          'Choose an existing service area or name a new one.',
          { serviceAreaId: 'Choose one', serviceAreaName: 'or name a new area' },
          'SERVICE_AREA_REQUIRED',
        );
      }
      if (input.serviceAreaName) {
        const taken = await prisma.serviceArea.count({ where: { name: input.serviceAreaName } });
        if (taken > 0) {
          throw new ConflictError('A service area with this name already exists.', 'AREA_EXISTS');
        }
      }
      let changed: string[] = [];
      let canteenId: string;
      try {
        canteenId = await prisma.$transaction(async (tx) => {
          const area = input.serviceAreaId
            ? await tx.serviceArea.findUnique({ where: { id: input.serviceAreaId } })
            : await tx.serviceArea.create({
                data: {
                  name: input.serviceAreaName!,
                  slug: await uniqueSlug(tx, 'serviceArea', input.serviceAreaName!),
                },
              });
          if (!area) {
            throw new ValidationError(
              'Choose a valid service area.',
              undefined,
              'INVALID_SERVICE_AREA',
            );
          }
          const created = await tx.canteen.create({
            data: {
              name: input.name,
              slug: await uniqueSlug(tx, 'canteen', input.name),
              type: input.type,
              serviceAreaId: area.id,
              location: input.location ?? null,
              openingHours: input.openingHours ?? null,
              isActive: input.isActive ?? true,
              // Opened below, through the exclusivity check.
              isAcceptingOrders: false,
              paymentConfig: { create: { mode: 'DEMO', isActive: false } },
              services: {
                create: { period: input.type, isEnabled: true, override: 'FORCE_OPEN' },
              },
            },
            select: { id: true },
          });
          const wantsOrders = input.isAcceptingOrders ?? true;
          if (wantsOrders && (input.isActive ?? true)) {
            const open = await tx.canteen.count({
              where: { serviceAreaId: area.id, isActive: true, isAcceptingOrders: true },
            });
            // A new canteen never silently closes its sibling: it opens only
            // when nothing else in the area is taking orders.
            if (open === 0 || input.isAcceptingOrders === true) {
              changed = (await applyOrderTaking(tx, created.id, { isAcceptingOrders: true }))
                .changedCanteenIds;
            }
          }
          return created.id;
        });
      } catch (err) {
        canteenConflict(err);
      }
      await emitOrderTaking([canteenId, ...changed]);
      // A scheduled area puts the right canteen on duty at once.
      const { serviceAreaId: createdArea } = await prisma.canteen.findUniqueOrThrow({
        where: { id: canteenId },
        select: { serviceAreaId: true },
      });
      await scheduler.reconcileArea(createdArea, clock());
      const canteen = await prisma.canteen.findUniqueOrThrow({
        where: { id: canteenId },
        select: canteenSelect,
      });
      writeAudit(logger, {
        actor: { role: 'ADMIN', id: admin.id },
        action: 'admin.canteen.created',
        target: { type: 'canteen', id: canteenId },
        after: { name: canteen.name, type: canteen.type, serviceAreaId: canteen.serviceAreaId },
      });
      return toCanteenDto(canteen);
    },

    async updateCanteen(admin: AdminPrincipal, canteenId: string, patch: CanteenPatch) {
      const before = await prisma.canteen.findUnique({ where: { id: canteenId } });
      if (!before) throw new NotFoundError('Canteen not found.', 'CANTEEN_NOT_FOUND');
      const { isActive, isAcceptingOrders, isPaused, type, serviceAreaId, ...details } = patch;
      const now = clock();
      let changed: string[] = [];
      try {
        changed = await prisma.$transaction(async (tx) => {
          if (serviceAreaId && serviceAreaId !== before.serviceAreaId) {
            const area = await tx.serviceArea.findUnique({ where: { id: serviceAreaId } });
            if (!area) {
              throw new ValidationError(
                'Choose a valid service area.',
                undefined,
                'INVALID_SERVICE_AREA',
              );
            }
            // Moving an open canteen must not create a second open canteen.
            if (before.isActive && before.isAcceptingOrders) {
              await tx.canteen.update({
                where: { id: canteenId },
                data: { isAcceptingOrders: false },
              });
            }
            await tx.canteen.update({ where: { id: canteenId }, data: { serviceAreaId } });
          }
          if (type && type !== before.type) {
            await tx.canteen.update({ where: { id: canteenId }, data: { type } });
            await ensureTypeService(tx, canteenId, before.type, type);
          }
          if (Object.values(details).some((value) => value !== undefined)) {
            await tx.canteen.update({ where: { id: canteenId }, data: details });
          }
          const moved =
            serviceAreaId && serviceAreaId !== before.serviceAreaId && before.isAcceptingOrders;
          const result = await applyOrderTaking(tx, canteenId, {
            isActive,
            // A moved canteen re-opens only if asked and its new area allows it.
            isAcceptingOrders: isAcceptingOrders ?? (moved ? false : undefined),
          });
          const ids = [...result.changedCanteenIds];
          if (moved) ids.push(canteenId);
          if (isPaused !== undefined && isPaused !== before.isPaused) {
            await tx.canteen.update({ where: { id: canteenId }, data: { isPaused } });
            ids.push(canteenId);
          }
          // An explicit on-duty change by an admin is a manual choice for the area.
          if (isAcceptingOrders !== undefined) {
            await recordManualChoice(
              tx,
              serviceAreaId ?? before.serviceAreaId,
              admin.id,
              'NEXT_TRANSITION',
              now,
            );
          }
          return [...new Set(ids)];
        });
      } catch (err) {
        canteenConflict(err);
      }
      await emitOrderTaking(changed);
      const canteen = await prisma.canteen.findUniqueOrThrow({
        where: { id: canteenId },
        select: canteenSelect,
      });
      writeAudit(logger, {
        actor: { role: 'ADMIN', id: admin.id },
        action: 'admin.canteen.updated',
        target: { type: 'canteen', id: canteenId },
        before: {
          name: before.name,
          type: before.type,
          serviceAreaId: before.serviceAreaId,
          isActive: before.isActive,
          isAcceptingOrders: before.isAcceptingOrders,
          isPaused: before.isPaused,
        },
        after: {
          name: canteen.name,
          type: canteen.type,
          serviceAreaId: canteen.serviceAreaId,
          isActive: canteen.isActive,
          isAcceptingOrders: canteen.isAcceptingOrders,
          isPaused: canteen.isPaused,
        },
      });
      return toCanteenDto(canteen, now);
    },

    async listHostels() {
      const rows = await prisma.hostel.findMany({ select: hostelSelect, orderBy: { name: 'asc' } });
      return rows.map(toHostelDto);
    },

    /** `serviceAreaId`, or the legacy `canteenId` (its area is used). */
    async createHostel(input: {
      name: string;
      serviceAreaId?: string | undefined;
      canteenId?: string | undefined;
    }) {
      const serviceAreaId = await resolveArea(input);
      if (!serviceAreaId) {
        throw new ValidationError('Choose a service area.', undefined, 'INVALID_SERVICE_AREA');
      }
      try {
        return toHostelDto(
          await prisma.hostel.create({
            data: { name: input.name, serviceAreaId },
            select: hostelSelect,
          }),
        );
      } catch (err) {
        if (isUniqueViolation(err))
          throw new ConflictError('A hostel with this name already exists.', 'HOSTEL_EXISTS');
        throw err;
      }
    },

    async updateHostel(
      hostelId: string,
      patch: {
        name?: string | undefined;
        serviceAreaId?: string | undefined;
        canteenId?: string | undefined;
        isActive?: boolean | undefined;
      },
    ) {
      const hostel = await prisma.hostel.findUnique({ where: { id: hostelId } });
      if (!hostel) throw new NotFoundError('Hostel not found.', 'HOSTEL_NOT_FOUND');
      const serviceAreaId = await resolveArea(patch);
      try {
        return toHostelDto(
          await prisma.hostel.update({
            where: { id: hostelId },
            data: {
              ...(patch.name !== undefined ? { name: patch.name } : {}),
              ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
              ...(serviceAreaId ? { serviceAreaId } : {}),
            },
            select: hostelSelect,
          }),
        );
      } catch (err) {
        if (isUniqueViolation(err))
          throw new ConflictError('A hostel with this name already exists.', 'HOSTEL_EXISTS');
        throw err;
      }
    },

    async listStaff(
      filter: {
        status?: StaffStatus | undefined;
        canteenId?: string | undefined;
        capability?: 'KITCHEN' | 'MENU' | 'PAUSE' | 'CASHIER' | undefined;
      },
      page: Pagination,
    ) {
      const rows = await prisma.staff.findMany({
        where: {
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.canteenId && !filter.capability ? { canteenId: filter.canteenId } : {}),
          ...(filter.capability
            ? {
                assignments: {
                  some: {
                    ...(filter.canteenId ? { canteenId: filter.canteenId } : {}),
                    capabilities: { some: { capability: filter.capability } },
                  },
                },
              }
            : {}),
        },
        select: staffSelect,
        ...pageArgs(page),
      });
      return toPage(rows, page);
    },

    async getStaff(staffId: string) {
      const staff = await prisma.staff.findUnique({
        where: { id: staffId },
        select: {
          ...staffSelect,
          changeRequests: {
            select: {
              id: true,
              status: true,
              notes: true,
              reviewNotes: true,
              reviewedAt: true,
              createdAt: true,
              requestedCanteen: { select: { id: true, name: true } },
              fromCanteen: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
          },
        },
      });
      if (!staff) throw new NotFoundError('Staff member not found.', 'STAFF_NOT_FOUND');
      return { ...staff, assignments: await listStaffAssignments(prisma, staffId) };
    },

    /**
     * Directly approve/assign (or reassign) a staff member to a canteen.
     * A pending request for the same canteen is marked approved by this admin.
     */
    async assignStaff(
      admin: AdminPrincipal,
      staffId: string,
      canteenId: string,
      options: { replaceExisting?: boolean | undefined } = {},
    ) {
      const [staff, canteen] = await Promise.all([
        prisma.staff.findUnique({ where: { id: staffId } }),
        prisma.canteen.findUnique({ where: { id: canteenId } }),
      ]);
      if (!staff) throw new NotFoundError('Staff member not found.', 'STAFF_NOT_FOUND');
      if (!canteen)
        throw new ValidationError('Choose a valid canteen.', undefined, 'INVALID_CANTEEN');
      if (!canteen.isActive)
        throw new ConflictError('The canteen is inactive.', 'CANTEEN_INACTIVE');

      const wasApproved = staff.status === 'APPROVED';
      const outbox = new Outbox();
      const release: { account: { id: string; email: string } | null } = { account: null };
      const updated = await prisma.$transaction(async (tx) => {
        const { released } = await assignDedicatedAccount(tx, outbox, {
          staffId,
          canteen: { id: canteen.id, name: canteen.name },
          replaceExisting: options.replaceExisting,
        });
        release.account = released;
        const result = await tx.staff.findUniqueOrThrow({
          where: { id: staffId },
          select: staffSelect,
        });
        await tx.canteenChangeRequest.updateMany({
          where: { staffId, status: 'PENDING', requestedCanteenId: canteenId },
          data: { status: 'APPROVED', reviewedAt: new Date(), reviewedByAdminId: admin.id },
        });
        await writeNotifications(tx, outbox, [{ kind: 'staff', id: staffId }], {
          type: wasApproved ? 'STAFF_CANTEEN_ASSIGNED' : 'STAFF_APPROVED',
          title: wasApproved ? 'Canteen assignment updated' : 'Access approved',
          message: `You are now assigned to ${canteen.name}.`,
          data: { canteenId },
        });
        return result;
      });

      const targets = [rooms.staff(staffId), rooms.admins()];
      const payload = {
        staffId,
        status: 'APPROVED',
        canteen: { id: canteen.id, name: canteen.name },
      };
      outbox.command({ type: 'staff-canteen-changed', staffId, canteenId });
      if (!wasApproved) outbox.emit('staff.approved', targets, payload);
      outbox.emit('staff.canteen_assigned', targets, payload);
      outbox.flush(events);
      writeAudit(logger, {
        actor: { role: 'ADMIN', id: admin.id },
        action: 'admin.staff.assigned',
        target: { type: 'staff', id: staffId },
        before: { status: staff.status, canteenId: staff.canteenId },
        after: {
          status: 'APPROVED',
          canteenId,
          capabilities: ['KITCHEN', 'MENU', 'PAUSE'],
          replacedStaffId: release.account?.id ?? null,
        },
      });
      return updated;
    },

    async deactivateStaff(admin: AdminPrincipal, staffId: string) {
      const staff = await prisma.staff.findUnique({ where: { id: staffId } });
      if (!staff) throw new NotFoundError('Staff member not found.', 'STAFF_NOT_FOUND');
      if (staff.status === 'DEACTIVATED') {
        throw new ConflictError(
          'This staff member is already deactivated.',
          'STAFF_ALREADY_DEACTIVATED',
        );
      }
      const outbox = new Outbox();
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.staff.update({
          where: { id: staffId },
          data: { status: 'DEACTIVATED', canteenId: null },
          select: staffSelect,
        });
        await tx.staffCanteenAssignment.deleteMany({ where: { staffId } });
        await tx.canteenChangeRequest.updateMany({
          where: { staffId, status: 'PENDING' },
          data: {
            status: 'REJECTED',
            reviewedAt: new Date(),
            reviewedByAdminId: admin.id,
            reviewNotes: 'Staff deactivated',
          },
        });
        await writeNotifications(tx, outbox, [{ kind: 'staff', id: staffId }], {
          type: 'STAFF_DEACTIVATED',
          title: 'Account deactivated',
          message: 'Your SERVE staff access has been deactivated by an admin.',
        });
        return result;
      });
      outbox.emit('staff.deactivated', [rooms.staff(staffId), rooms.admins()], {
        staffId,
        status: 'DEACTIVATED',
      });
      outbox.command({ type: 'disconnect-staff', staffId });
      outbox.flush(events);
      writeAudit(logger, {
        actor: { role: 'ADMIN', id: admin.id },
        action: 'admin.staff.deactivated',
        target: { type: 'staff', id: staffId },
        before: { status: staff.status, canteenId: staff.canteenId },
        after: { status: 'DEACTIVATED', canteenId: null },
      });
      return updated;
    },
  };
}

/** `serviceAreaId` wins; a legacy `canteenId` maps to that canteen's area. */
async function resolveAreaWith(
  prisma: PrismaClient,
  input: { serviceAreaId?: string | undefined; canteenId?: string | undefined },
): Promise<string | null> {
  if (input.serviceAreaId) {
    const area = await prisma.serviceArea.findUnique({ where: { id: input.serviceAreaId } });
    if (!area) {
      throw new ValidationError('Choose a valid service area.', undefined, 'INVALID_SERVICE_AREA');
    }
    return area.id;
  }
  if (input.canteenId) {
    const canteen = await prisma.canteen.findUnique({ where: { id: input.canteenId } });
    if (!canteen)
      throw new ValidationError('Choose a valid canteen.', undefined, 'INVALID_CANTEEN');
    return canteen.serviceAreaId;
  }
  return null;
}

/**
 * After a type change, make sure the canteen has a service row and a price
 * for every menu item in its new period (copied from the old period).
 */
async function ensureTypeService(
  tx: Prisma.TransactionClient,
  canteenId: string,
  from: ServicePeriod,
  to: ServicePeriod,
) {
  await tx.canteenService.upsert({
    where: { canteenId_period: { canteenId, period: to } },
    create: { canteenId, period: to, isEnabled: true, override: 'FORCE_OPEN' },
    update: {},
  });
  const items = await tx.menuItem.findMany({
    where: { canteenId },
    select: { id: true, pricePaise: true, isAvailable: true, services: true },
  });
  for (const item of items) {
    if (item.services.some((row) => row.period === to)) continue;
    const source = item.services.find((row) => row.period === from);
    await tx.menuItemService.create({
      data: {
        menuItemId: item.id,
        period: to,
        pricePaise: source?.pricePaise ?? item.pricePaise,
        isAvailable: source?.isAvailable ?? item.isAvailable,
      },
    });
  }
}

export type AdminService = ReturnType<typeof createAdminService>;
