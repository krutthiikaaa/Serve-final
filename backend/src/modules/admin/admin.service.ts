import type { Prisma, StaffStatus } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { startOfIstDay } from '../../lib/time.js';
import { Outbox, rooms, type EventPublisher } from '../../realtime/events.js';
import { pageArgs, toPage, type Pagination } from '../../http/validation.js';
import type { AdminPrincipal } from '../auth/principal.js';
import { writeNotifications } from '../notifications/notification.writer.js';
import { canteenSelect, orderTakingPayload, toCanteenDto } from '../canteens/canteen.dto.js';

export interface CanteenInput {
  name: string;
  slug?: string | undefined;
  location?: string | null | undefined;
  openingHours?: string | null | undefined;
  isActive?: boolean | undefined;
  isAcceptingOrders?: boolean | undefined;
}
export type CanteenPatch = Partial<CanteenInput>;

const staffSelect = {
  id: true,
  name: true,
  email: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  canteen: { select: { id: true, name: true } },
} satisfies Prisma.StaffSelect;

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function createAdminService(prisma: PrismaClient, events: EventPublisher) {
  function canteenConflict(err: unknown): never {
    if (isUniqueViolation(err, 'name'))
      throw new ConflictError('A canteen with this name already exists.', 'CANTEEN_NAME_TAKEN');
    if (isUniqueViolation(err, 'slug'))
      throw new ConflictError('A canteen with this slug already exists.', 'CANTEEN_SLUG_TAKEN');
    throw err;
  }

  function emitOrderTaking(canteen: Parameters<typeof orderTakingPayload>[0]) {
    const outbox = new Outbox();
    outbox.emit(
      'canteen.status_changed',
      [rooms.canteenPublic(canteen.id), rooms.canteen(canteen.id), rooms.admins()],
      orderTakingPayload(canteen),
    );
    outbox.flush(events);
  }

  return {
    /** Platform overview, computed from live data (one round of parallel aggregate queries). */
    async dashboard() {
      const since = startOfIstDay();
      const [canteenRows, pendingRequests, staffByStatus, activeOrders, today, todayByStatus] =
        await Promise.all([
          prisma.canteen.findMany({ select: { isActive: true, isAcceptingOrders: true } }),
          prisma.canteenChangeRequest.count({ where: { status: 'PENDING' } }),
          prisma.staff.groupBy({ by: ['status'], _count: { _all: true } }),
          prisma.order.groupBy({
            by: ['status'],
            where: { status: { in: ['PAYMENT_CONFIRMED', 'PREPARING', 'READY'] } },
            _count: { _all: true },
          }),
          prisma.order.aggregate({
            where: { paidAt: { gte: since }, status: { notIn: ['PLACED', 'CANCELLED'] } },
            _count: { _all: true },
            _sum: { totalPaise: true },
          }),
          prisma.order.groupBy({
            by: ['status'],
            where: { createdAt: { gte: since } },
            _count: { _all: true },
          }),
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
      return {
        canteens: {
          total: canteenRows.length,
          active: canteenRows.filter((c) => c.isActive).length,
          acceptingOrders: canteenRows.filter((c) => c.isActive && c.isAcceptingOrders).length,
          paused: canteenRows.filter((c) => c.isActive && !c.isAcceptingOrders).length,
          inactive: canteenRows.filter((c) => !c.isActive).length,
        },
        staff: {
          active: staffCount('APPROVED'),
          pending: staffCount('PENDING'),
          rejected: staffCount('REJECTED'),
          deactivated: staffCount('DEACTIVATED'),
        },
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
          /** Paid, non-cancelled orders (by payment time). */
          orderCount: today._count._all,
          revenuePaise: today._sum.totalPaise ?? 0,
          /** Orders created today, by current status. */
          createdByStatus: placedToday,
        },
      };
    },

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
      return canteens.map(({ _count, ...canteen }) => ({
        ...toCanteenDto(canteen),
        counts: { hostels: _count.hostels, activeStaff: _count.staff, menuItems: _count.menuItems },
      }));
    },

    async getCanteen(canteenId: string) {
      const canteen = await prisma.canteen.findUnique({
        where: { id: canteenId },
        select: {
          ...canteenSelect,
          hostels: { select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } },
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
      const { hostels, staff, categories, ...base } = canteen;
      return {
        ...toCanteenDto(base),
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

    async createCanteen(input: CanteenInput) {
      const slug = input.slug ?? slugify(input.name);
      if (!slug)
        throw new ValidationError(
          'Could not derive a slug from the name.',
          undefined,
          'INVALID_SLUG',
        );
      try {
        const canteen = await prisma.canteen.create({
          data: {
            name: input.name,
            slug,
            location: input.location ?? null,
            openingHours: input.openingHours ?? null,
            isActive: input.isActive ?? true,
            isAcceptingOrders: input.isAcceptingOrders ?? true,
          },
          select: canteenSelect,
        });
        emitOrderTaking(canteen);
        return toCanteenDto(canteen);
      } catch (err) {
        canteenConflict(err);
      }
    },

    async updateCanteen(canteenId: string, patch: CanteenPatch) {
      const before = await prisma.canteen.findUnique({ where: { id: canteenId } });
      if (!before) throw new NotFoundError('Canteen not found.', 'CANTEEN_NOT_FOUND');
      let canteen;
      try {
        canteen = await prisma.canteen.update({
          where: { id: canteenId },
          data: patch,
          select: canteenSelect,
        });
      } catch (err) {
        canteenConflict(err);
      }
      if (
        before.isActive !== canteen.isActive ||
        before.isAcceptingOrders !== canteen.isAcceptingOrders
      ) {
        emitOrderTaking(canteen);
      }
      return toCanteenDto(canteen);
    },

    async listHostels() {
      return prisma.hostel.findMany({
        select: {
          id: true,
          name: true,
          isActive: true,
          canteen: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
      });
    },

    async createHostel(input: { name: string; canteenId: string }) {
      const canteen = await prisma.canteen.findUnique({ where: { id: input.canteenId } });
      if (!canteen)
        throw new ValidationError('Choose a valid canteen.', undefined, 'INVALID_CANTEEN');
      try {
        return await prisma.hostel.create({
          data: input,
          select: {
            id: true,
            name: true,
            isActive: true,
            canteen: { select: { id: true, name: true } },
          },
        });
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
        canteenId?: string | undefined;
        isActive?: boolean | undefined;
      },
    ) {
      const hostel = await prisma.hostel.findUnique({ where: { id: hostelId } });
      if (!hostel) throw new NotFoundError('Hostel not found.', 'HOSTEL_NOT_FOUND');
      if (patch.canteenId) {
        const canteen = await prisma.canteen.findUnique({ where: { id: patch.canteenId } });
        if (!canteen)
          throw new ValidationError('Choose a valid canteen.', undefined, 'INVALID_CANTEEN');
      }
      try {
        return await prisma.hostel.update({
          where: { id: hostelId },
          data: patch,
          select: {
            id: true,
            name: true,
            isActive: true,
            canteen: { select: { id: true, name: true } },
          },
        });
      } catch (err) {
        if (isUniqueViolation(err))
          throw new ConflictError('A hostel with this name already exists.', 'HOSTEL_EXISTS');
        throw err;
      }
    },

    async listStaff(
      filter: { status?: StaffStatus | undefined; canteenId?: string | undefined },
      page: Pagination,
    ) {
      const rows = await prisma.staff.findMany({
        where: {
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.canteenId ? { canteenId: filter.canteenId } : {}),
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
      return staff;
    },

    /**
     * Directly approve/assign (or reassign) a staff member to a canteen.
     * A pending request for the same canteen is marked approved by this admin.
     */
    async assignStaff(admin: AdminPrincipal, staffId: string, canteenId: string) {
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
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.staff.update({
          where: { id: staffId },
          data: { status: 'APPROVED', canteenId },
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
      return updated;
    },
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
