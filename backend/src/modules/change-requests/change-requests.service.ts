import type { ChangeRequestStatus, Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { Outbox, rooms, type EventPublisher } from '../../realtime/events.js';
import { pageArgs, toPage, type Pagination } from '../../http/validation.js';
import type { AdminPrincipal, StaffPrincipal } from '../auth/principal.js';
import { activeAdminRecipients, writeNotifications } from '../notifications/notification.writer.js';

export const changeRequestInclude = {
  staff: { select: { id: true, name: true, email: true, status: true } },
  requestedCanteen: { select: { id: true, name: true } },
  fromCanteen: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
} satisfies Prisma.CanteenChangeRequestInclude;

type ChangeRequestRow = Prisma.CanteenChangeRequestGetPayload<{
  include: typeof changeRequestInclude;
}>;

export function toChangeRequestDto(request: ChangeRequestRow) {
  return {
    id: request.id,
    status: request.status,
    notes: request.notes,
    reviewNotes: request.reviewNotes,
    staff: request.staff,
    requestedCanteen: request.requestedCanteen,
    fromCanteen: request.fromCanteen,
    reviewedBy: request.reviewedBy,
    reviewedAt: request.reviewedAt,
    createdAt: request.createdAt,
  };
}

/**
 * Staff canteen access / reassignment requests. Only admins review them; the
 * reviewer is always an Admin principal, so staff can never approve their own.
 */
export function createChangeRequestsService(prisma: PrismaClient, events: EventPublisher) {
  return {
    async create(
      staff: StaffPrincipal,
      input: { requestedCanteenId: string; notes?: string | null | undefined },
    ) {
      const canteen = await prisma.canteen.findUnique({ where: { id: input.requestedCanteenId } });
      if (!canteen || !canteen.isActive)
        throw new NotFoundError('Canteen not found.', 'CANTEEN_NOT_FOUND');
      if (staff.status === 'APPROVED' && staff.canteenId === canteen.id) {
        throw new ConflictError('You are already assigned to this canteen.', 'ALREADY_ASSIGNED');
      }

      const outbox = new Outbox();
      let request: ChangeRequestRow;
      try {
        request = await prisma.$transaction(async (tx) => {
          const created = await tx.canteenChangeRequest.create({
            data: {
              staffId: staff.id,
              requestedCanteenId: canteen.id,
              fromCanteenId: staff.status === 'APPROVED' ? staff.canteenId : null,
              notes: input.notes ?? null,
            },
            include: changeRequestInclude,
          });
          // A previously rejected applicant is awaiting review again.
          if (staff.status === 'REJECTED') {
            await tx.staff.update({ where: { id: staff.id }, data: { status: 'PENDING' } });
          }
          await writeNotifications(tx, outbox, await activeAdminRecipients(tx), {
            type: 'STAFF_ACCESS_REQUESTED',
            title: created.fromCanteenId
              ? 'Staff reassignment request'
              : 'New staff access request',
            message: `${staff.name} requested access to ${canteen.name}.`,
            data: { changeRequestId: created.id, staffId: staff.id },
          });
          return tx.canteenChangeRequest.findUniqueOrThrow({
            where: { id: created.id },
            include: changeRequestInclude,
          });
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError('You already have a pending request.', 'CHANGE_REQUEST_PENDING');
        }
        throw err;
      }
      const dto = toChangeRequestDto(request);
      outbox.emit('change_request:created', [rooms.admins()], { changeRequest: dto });
      outbox.flush(events);
      return dto;
    },

    async listForStaff(staff: StaffPrincipal, page: Pagination) {
      const rows = await prisma.canteenChangeRequest.findMany({
        where: { staffId: staff.id },
        include: changeRequestInclude,
        ...pageArgs(page),
      });
      const result = toPage(rows, page);
      return { ...result, data: result.data.map(toChangeRequestDto) };
    },

    async listForAdmin(status: ChangeRequestStatus | undefined, page: Pagination) {
      const rows = await prisma.canteenChangeRequest.findMany({
        where: status ? { status } : {},
        include: changeRequestInclude,
        ...pageArgs(page),
      });
      const result = toPage(rows, page);
      return { ...result, data: result.data.map(toChangeRequestDto) };
    },

    async review(
      admin: AdminPrincipal,
      requestId: string,
      decision: 'APPROVED' | 'REJECTED',
      reviewNotes?: string | null,
    ) {
      const existing = await prisma.canteenChangeRequest.findUnique({
        where: { id: requestId },
        include: { staff: true, requestedCanteen: true },
      });
      if (!existing)
        throw new NotFoundError('Change request not found.', 'CHANGE_REQUEST_NOT_FOUND');
      if (existing.status !== 'PENDING') {
        throw new ConflictError(
          'This request has already been reviewed.',
          'CHANGE_REQUEST_ALREADY_REVIEWED',
        );
      }
      if (existing.staff.status === 'DEACTIVATED') {
        throw new ForbiddenError('This staff account is deactivated.', 'STAFF_DEACTIVATED');
      }
      if (decision === 'APPROVED' && !existing.requestedCanteen.isActive) {
        throw new ConflictError('The requested canteen is inactive.', 'CANTEEN_INACTIVE');
      }

      const outbox = new Outbox();
      const wasApproved = existing.staff.status === 'APPROVED';
      const request = await prisma.$transaction(async (tx) => {
        const reviewed = await tx.canteenChangeRequest.updateMany({
          where: { id: requestId, status: 'PENDING' },
          data: {
            status: decision,
            reviewedByAdminId: admin.id,
            reviewedAt: new Date(),
            reviewNotes: reviewNotes ?? null,
          },
        });
        if (reviewed.count === 0) {
          throw new ConflictError(
            'This request has already been reviewed.',
            'CHANGE_REQUEST_ALREADY_REVIEWED',
          );
        }
        const staffRecipient = [{ kind: 'staff' as const, id: existing.staffId }];
        if (decision === 'APPROVED') {
          await tx.staff.update({
            where: { id: existing.staffId },
            data: { status: 'APPROVED', canteenId: existing.requestedCanteenId },
          });
          await writeNotifications(tx, outbox, staffRecipient, {
            type: wasApproved ? 'STAFF_CANTEEN_ASSIGNED' : 'STAFF_APPROVED',
            title: wasApproved ? 'Canteen assignment updated' : 'Access approved',
            message: `You now have access to ${existing.requestedCanteen.name}.`,
            data: { canteenId: existing.requestedCanteenId },
          });
        } else {
          if (!wasApproved) {
            await tx.staff.update({
              where: { id: existing.staffId },
              data: { status: 'REJECTED' },
            });
          }
          await writeNotifications(tx, outbox, staffRecipient, {
            type: 'STAFF_REJECTED',
            title: 'Request not approved',
            message: `Your request for ${existing.requestedCanteen.name} was not approved.`,
            data: { canteenId: existing.requestedCanteenId },
          });
        }
        return tx.canteenChangeRequest.findUniqueOrThrow({
          where: { id: requestId },
          include: changeRequestInclude,
        });
      });

      const dto = toChangeRequestDto(request);
      const targets = [rooms.staff(existing.staffId), rooms.admins()];
      outbox.emit('change_request:updated', targets, { changeRequest: dto });
      if (decision === 'APPROVED') {
        const canteen = { id: existing.requestedCanteen.id, name: existing.requestedCanteen.name };
        outbox.command({
          type: 'staff-canteen-changed',
          staffId: existing.staffId,
          canteenId: canteen.id,
        });
        outbox.emit(wasApproved ? 'staff:canteen_assignment_updated' : 'staff:approved', targets, {
          staffId: existing.staffId,
          status: 'APPROVED',
          canteen,
        });
        if (!wasApproved) {
          outbox.emit('staff:canteen_assignment_updated', targets, {
            staffId: existing.staffId,
            status: 'APPROVED',
            canteen,
          });
        }
      } else if (!wasApproved) {
        outbox.emit('staff:rejected', targets, { staffId: existing.staffId, status: 'REJECTED' });
      }
      outbox.flush(events);
      return dto;
    },
  };
}

export type ChangeRequestsService = ReturnType<typeof createChangeRequestsService>;
