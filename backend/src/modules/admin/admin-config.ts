import type { Logger } from 'pino';
import type { PaymentMode, ScheduleOverride, ServicePeriod } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { canteenSelect, toCanteenDto, type CanteenRow } from '../canteens/canteen.dto.js';
import { inspectOperatingSchedules, operatingSchedulesOverlap, validateOperatingSchedules } from '../canteens/schedule.js';
import type { AdminPrincipal } from '../auth/principal.js';
import {
  listStaffAssignments,
  replaceStaffAssignments,
  type StaffAssignmentInput,
} from '../staff/assignments.js';
import {
  ensureDemoPaymentConfig,
  officialDetailsReady,
  toAdminPaymentConfigDto,
} from '../canteens/payment-config.js';

export type AdminConfigurationWarning =
  | 'AUTO_WITHOUT_SCHEDULE'
  | 'INVALID_SCHEDULE'
  | 'SERVICE_WITHOUT_MENU_PRICES'
  | 'SERVICE_DISABLED'
  | 'PERIOD_SCHEDULE_OVERLAP';

export interface AdminWarning {
  period: ServicePeriod | null;
  code: AdminConfigurationWarning;
}

export interface ServiceConfigInput {
  period: ServicePeriod;
  isEnabled: boolean;
  override: ScheduleOverride;
}

export interface ScheduleRowInput {
  weekday: number;
  opensAtMinutes: number;
  closesAtMinutes: number;
}

export interface MenuItemServiceInput {
  period: ServicePeriod;
  pricePaise: number;
  isAvailable: boolean;
}

export interface PaymentConfigInput {
  mode?: PaymentMode | undefined;
  upiVpa?: string | null | undefined;
  merchantName?: string | null | undefined;
  qrImageUrl?: string | null | undefined;
  qrStorageKey?: string | null | undefined;
  instructions?: string | null | undefined;
  isActive?: boolean | undefined;
}

function actorOf(admin: AdminPrincipal) {
  return { role: 'ADMIN' as const, id: admin.id };
}

export function toPaymentConfigDto(
  row: {
    canteenId: string;
    mode: PaymentMode;
    upiVpa: string | null;
    merchantName: string | null;
    qrImageUrl: string | null;
    qrStorageKey: string | null;
    instructions: string | null;
    isActive: boolean;
    updatedAt: Date;
  } | null,
) {
  if (!row) return null;
  return toAdminPaymentConfigDto(row);
}

function paymentAuditSnapshot(row: {
  mode: PaymentMode;
  merchantName: string | null;
  instructions: string | null;
  isActive: boolean;
  upiVpa: string | null;
  qrImageUrl: string | null;
  qrStorageKey: string | null;
} | null) {
  if (!row) return null;
  return {
    mode: row.mode,
    merchantName: row.merchantName,
    instructions: row.instructions,
    isActive: row.isActive,
    upiVpaSet: Boolean(row.upiVpa),
    qrImageUrlSet: Boolean(row.qrImageUrl),
    qrStorageKeySet: Boolean(row.qrStorageKey),
  };
}

export async function collectAdminWarnings(
  prisma: PrismaClient,
  canteen: CanteenRow,
): Promise<AdminWarning[]> {
  const warnings: AdminWarning[] = [];
  const services = canteen.services ?? [];
  const pricedByPeriod = await prisma.menuItemService.groupBy({
    by: ['period'],
    where: { menuItem: { canteenId: canteen.id, isActive: true } },
    _count: { _all: true },
  });
  const activeItemCount = await prisma.menuItem.count({
    where: { canteenId: canteen.id, isActive: true },
  });
  const priced = new Map(pricedByPeriod.map((row) => [row.period, row._count._all]));

  for (const service of services) {
    if (!service.isEnabled) {
      warnings.push({ period: service.period, code: 'SERVICE_DISABLED' });
    }
    const inspection = inspectOperatingSchedules(service.schedules);
    if (!inspection.ok) {
      warnings.push({ period: service.period, code: 'INVALID_SCHEDULE' });
    }
    if (service.override === 'AUTO' && service.schedules.length === 0) {
      warnings.push({ period: service.period, code: 'AUTO_WITHOUT_SCHEDULE' });
    }
    if (activeItemCount > 0 && (priced.get(service.period) ?? 0) < activeItemCount) {
      warnings.push({ period: service.period, code: 'SERVICE_WITHOUT_MENU_PRICES' });
    }
  }

  const day = services.find((service) => service.period === 'DAY');
  const night = services.find((service) => service.period === 'NIGHT');
  if (day && night && operatingSchedulesOverlap(day.schedules, night.schedules)) {
    warnings.push({ period: null, code: 'PERIOD_SCHEDULE_OVERLAP' });
  }
  return warnings;
}

export async function loadAdminCanteenConfig(prisma: PrismaClient, canteenId: string) {
  const canteen = await prisma.canteen.findUnique({
    where: { id: canteenId },
    select: canteenSelect,
  });
  if (!canteen) throw new NotFoundError('Canteen not found.', 'CANTEEN_NOT_FOUND');
  return {
    ...toCanteenDto(canteen),
    services: (canteen.services ?? []).map((service) => ({
      period: service.period,
      isEnabled: service.isEnabled,
      override: service.override,
      schedules: service.schedules,
    })),
    configurationWarnings: await collectAdminWarnings(prisma, canteen),
  };
}

export function createAdminConfigService(prisma: PrismaClient, logger: Logger) {
  async function requireCanteen(canteenId: string) {
    const canteen = await prisma.canteen.findUnique({
      where: { id: canteenId },
      select: { id: true, name: true },
    });
    if (!canteen) throw new NotFoundError('Canteen not found.', 'CANTEEN_NOT_FOUND');
    return canteen;
  }

  return {
    async updateCanteenServices(
      admin: AdminPrincipal,
      canteenId: string,
      services: readonly ServiceConfigInput[],
    ) {
      await requireCanteen(canteenId);
      const periods = services.map((row) => row.period);
      if (new Set(periods).size !== periods.length) {
        throw new ValidationError(
          'Each service period may appear only once.',
          undefined,
          'DUPLICATE_SERVICE',
        );
      }

      const before = await prisma.canteenService.findMany({
        where: { canteenId },
        select: { period: true, isEnabled: true, override: true },
        orderBy: { period: 'asc' },
      });

      await prisma.$transaction(async (tx) => {
        for (const row of services) {
          await tx.canteenService.upsert({
            where: { canteenId_period: { canteenId, period: row.period } },
            create: {
              canteenId,
              period: row.period,
              isEnabled: row.isEnabled,
              override: row.override,
            },
            update: { isEnabled: row.isEnabled, override: row.override },
          });
        }
      });

      const after = await loadAdminCanteenConfig(prisma, canteenId);
      writeAudit(logger, {
        actor: actorOf(admin),
        action: 'admin.canteen.services.update',
        target: { type: 'canteen', id: canteenId },
        before: { services: before },
        after: {
          services: after.services.map((service) => ({
            period: service.period,
            isEnabled: service.isEnabled,
            override: service.override,
          })),
        },
      });
      return after;
    },

    async updateCanteenServiceSchedule(
      admin: AdminPrincipal,
      canteenId: string,
      period: ServicePeriod,
      schedules: readonly ScheduleRowInput[],
    ) {
      await requireCanteen(canteenId);
      const service = await prisma.canteenService.findUnique({
        where: { canteenId_period: { canteenId, period } },
        include: { schedules: true },
      });
      if (!service) {
        throw new NotFoundError('Service is not configured for this canteen.', 'SERVICE_NOT_CONFIGURED');
      }

      if (schedules.length === 0) {
        if (service.override === 'AUTO') {
          throw new ValidationError(
            'AUTO services require at least one operating schedule.',
            { period },
            'AUTO_WITHOUT_SCHEDULE',
          );
        }
      } else {
        validateOperatingSchedules(schedules);
      }

      const before = service.schedules.map((row) => ({
        weekday: row.weekday,
        opensAtMinutes: row.opensAtMinutes,
        closesAtMinutes: row.closesAtMinutes,
      }));

      await prisma.$transaction(async (tx) => {
        await tx.canteenOperatingSchedule.deleteMany({ where: { canteenServiceId: service.id } });
        if (schedules.length > 0) {
          await tx.canteenOperatingSchedule.createMany({
            data: schedules.map((row) => ({
              canteenServiceId: service.id,
              weekday: row.weekday,
              opensAtMinutes: row.opensAtMinutes,
              closesAtMinutes: row.closesAtMinutes,
            })),
          });
        }
      });

      const after = await loadAdminCanteenConfig(prisma, canteenId);
      writeAudit(logger, {
        actor: actorOf(admin),
        action: 'admin.canteen.schedule.update',
        target: { type: 'canteen-service', id: `${canteenId}:${period}` },
        before: { period, schedules: before },
        after: {
          period,
          schedules: after.services.find((row) => row.period === period)?.schedules ?? [],
        },
      });
      return after;
    },

    async updateMenuItemServices(
      admin: AdminPrincipal,
      itemId: string,
      services: readonly MenuItemServiceInput[],
    ) {
      const periods = services.map((row) => row.period);
      if (new Set(periods).size !== periods.length) {
        throw new ValidationError(
          'Each service period may appear only once.',
          undefined,
          'DUPLICATE_SERVICE',
        );
      }
      for (const row of services) {
        if (!Number.isInteger(row.pricePaise) || row.pricePaise <= 0) {
          throw new ValidationError(
            'Price must be a positive integer number of paise.',
            { period: row.period, pricePaise: row.pricePaise },
            'INVALID_PRICE',
          );
        }
      }

      const item = await prisma.menuItem.findUnique({
        where: { id: itemId },
        include: { services: true },
      });
      if (!item) throw new NotFoundError('Menu item not found.', 'MENU_ITEM_NOT_FOUND');

      const before = item.services.map((row) => ({
        period: row.period,
        pricePaise: row.pricePaise,
        isAvailable: row.isAvailable,
      }));

      await prisma.$transaction(async (tx) => {
        for (const row of services) {
          await tx.menuItemService.upsert({
            where: { menuItemId_period: { menuItemId: itemId, period: row.period } },
            create: {
              menuItemId: itemId,
              period: row.period,
              pricePaise: row.pricePaise,
              isAvailable: row.isAvailable,
            },
            update: { pricePaise: row.pricePaise, isAvailable: row.isAvailable },
          });
        }
        const night = services.find((row) => row.period === 'NIGHT');
        if (night) {
          await tx.menuItem.update({
            where: { id: itemId },
            data: { pricePaise: night.pricePaise, isAvailable: night.isAvailable },
          });
        }
      });

      const updated = await prisma.menuItem.findUniqueOrThrow({
        where: { id: itemId },
        include: { services: { orderBy: { period: 'asc' } } },
      });
      const after = {
        id: updated.id,
        canteenId: updated.canteenId,
        name: updated.name,
        pricePaise: updated.pricePaise,
        isAvailable: updated.isAvailable,
        services: updated.services.map((row) => ({
          period: row.period,
          pricePaise: row.pricePaise,
          isAvailable: row.isAvailable,
        })),
      };
      writeAudit(logger, {
        actor: actorOf(admin),
        action: 'admin.menu.item.services.update',
        target: { type: 'menu-item', id: itemId },
        before: { services: before },
        after: { services: after.services },
      });
      return after;
    },

    async getPaymentConfig(canteenId: string) {
      await requireCanteen(canteenId);
      return toAdminPaymentConfigDto(await ensureDemoPaymentConfig(prisma, canteenId));
    },

    async updatePaymentConfig(admin: AdminPrincipal, canteenId: string, input: PaymentConfigInput) {
      await requireCanteen(canteenId);
      const existing = await ensureDemoPaymentConfig(prisma, canteenId);
      const data = {
        mode: input.mode === undefined ? existing.mode : input.mode,
        upiVpa: input.upiVpa === undefined ? existing.upiVpa : input.upiVpa,
        merchantName:
          input.merchantName === undefined ? existing.merchantName : input.merchantName,
        qrImageUrl: input.qrImageUrl === undefined ? existing.qrImageUrl : input.qrImageUrl,
        qrStorageKey:
          input.qrStorageKey === undefined ? existing.qrStorageKey : input.qrStorageKey,
        instructions:
          input.instructions === undefined ? existing.instructions : input.instructions,
        isActive: input.isActive === undefined ? existing.isActive : input.isActive,
      };
      if (data.mode === 'LIVE') {
        if (!officialDetailsReady(data)) {
          throw new ValidationError(
            'LIVE mode requires a valid UPI ID, merchant name, and official QR image or storage key.',
            {
              upiVpa: data.upiVpa ? undefined : 'Required for LIVE',
              merchantName: data.merchantName ? undefined : 'Required for LIVE',
              qrImageUrl: data.qrImageUrl || data.qrStorageKey ? undefined : 'Required for LIVE',
            },
            'LIVE_CONFIG_INCOMPLETE',
          );
        }
        data.isActive = true;
      }

      const row = await prisma.canteenPaymentConfig.update({ where: { canteenId }, data });

      writeAudit(logger, {
        actor: actorOf(admin),
        action: 'admin.canteen.payment_config.update',
        target: { type: 'canteen-payment-config', id: canteenId },
        before: paymentAuditSnapshot(existing),
        after: paymentAuditSnapshot(row),
      });
      if (existing.mode !== row.mode) {
        writeAudit(logger, {
          actor: actorOf(admin),
          action: 'admin.canteen.payment_mode.update',
          target: { type: 'canteen-payment-config', id: canteenId },
          before: { mode: existing.mode },
          after: { mode: row.mode },
        });
      }
      if (existing.qrImageUrl !== row.qrImageUrl || existing.qrStorageKey !== row.qrStorageKey) {
        writeAudit(logger, {
          actor: actorOf(admin),
          action: 'admin.canteen.payment_qr.update',
          target: { type: 'canteen-payment-config', id: canteenId },
          before: {
            qrImageUrlSet: Boolean(existing.qrImageUrl),
            qrStorageKeySet: Boolean(existing.qrStorageKey),
          },
          after: {
            qrImageUrlSet: Boolean(row.qrImageUrl),
            qrStorageKeySet: Boolean(row.qrStorageKey),
          },
        });
      }
      return toAdminPaymentConfigDto(row);
    },

    async updateStaffAssignments(
      admin: AdminPrincipal,
      staffId: string,
      input: { primaryCanteenId: string; assignments: StaffAssignmentInput[] },
    ) {
      const staff = await prisma.staff.findUnique({
        where: { id: staffId },
        select: { id: true, status: true, canteenId: true },
      });
      if (!staff) throw new NotFoundError('Staff member not found.', 'STAFF_NOT_FOUND');
      if (staff.status === 'DEACTIVATED') {
        throw new ConflictError('This staff member is deactivated.', 'STAFF_DEACTIVATED');
      }

      const before = {
        status: staff.status,
        canteenId: staff.canteenId,
        assignments: await listStaffAssignments(prisma, staffId),
      };

      await prisma.$transaction(async (tx) => {
        await replaceStaffAssignments(tx, staffId, input.primaryCanteenId, input.assignments);
      });

      const updated = await prisma.staff.findUniqueOrThrow({
        where: { id: staffId },
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          canteenId: true,
          canteen: { select: { id: true, name: true } },
        },
      });
      const assignments = await listStaffAssignments(prisma, staffId);
      const after = { ...updated, assignments };
      writeAudit(logger, {
        actor: actorOf(admin),
        action: 'admin.staff.assignments.update',
        target: { type: 'staff', id: staffId },
        before: {
          status: before.status,
          canteenId: before.canteenId,
          assignments: before.assignments.map((row) => ({
            canteenId: row.canteenId,
            capabilities: row.capabilities,
          })),
        },
        after: {
          status: after.status,
          canteenId: after.canteenId,
          assignments: after.assignments.map((row) => ({
            canteenId: row.canteenId,
            capabilities: row.capabilities,
          })),
        },
      });
      return after;
    },
  };
}

export type AdminConfigService = ReturnType<typeof createAdminConfigService>;
