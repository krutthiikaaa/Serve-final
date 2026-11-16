import type { Prisma, StaffCapability } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { rooms, type Outbox } from '../../realtime/events.js';
import { writeNotifications } from '../notifications/notification.writer.js';

/** Capabilities granted by the existing approve/assign flows. Never includes CASHIER. */
export const OPERATING_CAPABILITIES = [
  'KITCHEN',
  'MENU',
  'PAUSE',
] as const satisfies readonly StaffCapability[];

export const STAFF_CAPABILITIES = [
  'KITCHEN',
  'MENU',
  'PAUSE',
  'CASHIER',
] as const satisfies readonly StaffCapability[];

export type StaffCapabilityName = (typeof STAFF_CAPABILITIES)[number];

type Db = Pick<
  PrismaClient,
  'staff' | 'canteen' | 'staffCanteenAssignment' | 'staffAssignmentCapability'
>;
type Tx = Prisma.TransactionClient;

const assignmentInclude = {
  canteen: {
    select: { id: true, name: true, isActive: true, isAcceptingOrders: true, isPaused: true },
  },
  capabilities: { select: { capability: true }, orderBy: { capability: 'asc' as const } },
} satisfies Prisma.StaffCanteenAssignmentInclude;

export function toAssignmentDto(
  row: Prisma.StaffCanteenAssignmentGetPayload<{ include: typeof assignmentInclude }>,
) {
  return {
    canteenId: row.canteenId,
    canteen: row.canteen,
    capabilities: row.capabilities.map((entry) => entry.capability),
  };
}

export async function staffHasCapability(
  db: Db,
  staffId: string,
  canteenId: string,
  capability: StaffCapability,
): Promise<boolean> {
  const assignment = await db.staffCanteenAssignment.findUnique({
    where: { staffId_canteenId: { staffId, canteenId } },
    select: { capabilities: { select: { capability: true } } },
  });
  return assignment?.capabilities.some((entry) => entry.capability === capability) ?? false;
}

/**
 * Upsert the primary-canteen assignment and grant KITCHEN/MENU/PAUSE if missing.
 * Existing extra capabilities (including CASHIER) are left untouched.
 */
export async function ensureOperatingAssignment(db: Db, staffId: string, canteenId: string) {
  const assignment = await db.staffCanteenAssignment.upsert({
    where: { staffId_canteenId: { staffId, canteenId } },
    create: { staffId, canteenId },
    update: {},
    select: { id: true },
  });
  for (const capability of OPERATING_CAPABILITIES) {
    await db.staffAssignmentCapability.upsert({
      where: { assignmentId_capability: { assignmentId: assignment.id, capability } },
      create: { assignmentId: assignment.id, capability },
      update: {},
    });
  }
  return assignment;
}

/**
 * Make `staffId` the dedicated (only) approved account of `canteen`.
 *
 * - A staff account belongs to exactly one canteen: capability rows for any
 *   other canteen are removed.
 * - A canteen has at most one approved account
 *   (index Staff_one_approved_account_per_canteen). If another account holds
 *   the canteen, the call fails with 409 CANTEEN_HAS_STAFF_ACCOUNT unless
 *   `replaceExisting` is set; then that account loses access in the same
 *   transaction (status PENDING, no canteen, sockets disconnected).
 */
export async function assignDedicatedAccount(
  tx: Tx,
  outbox: Outbox,
  input: {
    staffId: string;
    canteen: { id: string; name: string };
    replaceExisting?: boolean | undefined;
  },
): Promise<{ released: { id: string; name: string; email: string } | null }> {
  const holder = await tx.staff.findFirst({
    where: { canteenId: input.canteen.id, status: 'APPROVED', id: { not: input.staffId } },
    select: { id: true, name: true, email: true },
  });
  if (holder && !input.replaceExisting) {
    throw new ConflictError(
      `${input.canteen.name} already has a dedicated staff account (${holder.email}). Replace it to continue.`,
      'CANTEEN_HAS_STAFF_ACCOUNT',
      { staff: holder },
    );
  }
  if (holder) {
    await tx.staff.update({
      where: { id: holder.id },
      data: { status: 'PENDING', canteenId: null },
    });
    await tx.staffCanteenAssignment.deleteMany({ where: { staffId: holder.id } });
    await writeNotifications(tx, outbox, [{ kind: 'staff', id: holder.id }], {
      type: 'STAFF_CANTEEN_ASSIGNED',
      title: 'Canteen access removed',
      message: `An admin assigned ${input.canteen.name} to another staff account.`,
      data: { canteenId: input.canteen.id },
    });
    outbox.emit('staff.unassigned', [rooms.staff(holder.id), rooms.admins()], {
      staffId: holder.id,
      status: 'PENDING',
    });
    outbox.command({ type: 'disconnect-staff', staffId: holder.id });
  }

  await tx.staffCanteenAssignment.deleteMany({
    where: { staffId: input.staffId, canteenId: { not: input.canteen.id } },
  });
  try {
    await tx.staff.update({
      where: { id: input.staffId },
      data: { status: 'APPROVED', canteenId: input.canteen.id },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(
        `${input.canteen.name} was just assigned to another staff account. Refresh and try again.`,
        'CANTEEN_HAS_STAFF_ACCOUNT',
      );
    }
    throw err;
  }
  await ensureOperatingAssignment(tx, input.staffId, input.canteen.id);
  return { released: holder };
}

export async function listStaffAssignments(db: Db, staffId: string) {
  const rows = await db.staffCanteenAssignment.findMany({
    where: { staffId },
    include: assignmentInclude,
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toAssignmentDto);
}

export interface StaffAssignmentInput {
  canteenId: string;
  capabilities: StaffCapabilityName[];
}

/**
 * Replace every assignment for a staff member. Primary Staff.canteenId is updated
 * in the same transaction. Status is never changed here.
 */
export async function replaceStaffAssignments(
  db: Db,
  staffId: string,
  primaryCanteenId: string,
  assignments: readonly StaffAssignmentInput[],
) {
  const canteenIds = assignments.map((row) => row.canteenId);
  if (canteenIds.some((canteenId) => canteenId !== primaryCanteenId)) {
    throw new ValidationError(
      'A staff account works for exactly one canteen. Assign each canteen its own account.',
      undefined,
      'SINGLE_CANTEEN_ONLY',
    );
  }
  if (new Set(canteenIds).size !== canteenIds.length) {
    throw new ValidationError(
      'Each canteen may appear only once in the assignment list.',
      undefined,
      'DUPLICATE_CANTEEN_ASSIGNMENT',
    );
  }
  if (!canteenIds.includes(primaryCanteenId)) {
    throw new ValidationError(
      'The primary canteen must be included in the assignment list.',
      undefined,
      'PRIMARY_ASSIGNMENT_REQUIRED',
    );
  }
  for (const row of assignments) {
    const uniqueCaps = new Set(row.capabilities);
    if (uniqueCaps.size !== row.capabilities.length) {
      throw new ValidationError(
        'Duplicate capabilities are not allowed on a single assignment.',
        { canteenId: row.canteenId },
        'DUPLICATE_CAPABILITY',
      );
    }
  }

  const canteens = await db.canteen.findMany({
    where: { id: { in: canteenIds } },
    select: { id: true },
  });
  if (canteens.length !== canteenIds.length) {
    throw new ValidationError('Choose a valid canteen.', undefined, 'INVALID_CANTEEN');
  }

  const existing = await db.staffCanteenAssignment.findMany({
    where: { staffId },
    select: { id: true, canteenId: true },
  });
  const incoming = new Set(canteenIds);
  const removed = existing.filter((row) => !incoming.has(row.canteenId));
  if (removed.length > 0) {
    await db.staffCanteenAssignment.deleteMany({
      where: { id: { in: removed.map((row) => row.id) } },
    });
  }

  for (const row of assignments) {
    const assignment = await db.staffCanteenAssignment.upsert({
      where: { staffId_canteenId: { staffId, canteenId: row.canteenId } },
      create: { staffId, canteenId: row.canteenId },
      update: {},
      select: { id: true },
    });
    await db.staffAssignmentCapability.deleteMany({
      where: {
        assignmentId: assignment.id,
        ...(row.capabilities.length > 0 ? { capability: { notIn: row.capabilities } } : {}),
      },
    });
    for (const capability of row.capabilities) {
      await db.staffAssignmentCapability.upsert({
        where: { assignmentId_capability: { assignmentId: assignment.id, capability } },
        create: { assignmentId: assignment.id, capability },
        update: {},
      });
    }
  }

  const staff = await db.staff.findUnique({ where: { id: staffId }, select: { id: true } });
  if (!staff) throw new NotFoundError('Staff member not found.', 'STAFF_NOT_FOUND');
  await db.staff.update({
    where: { id: staffId },
    data: { canteenId: primaryCanteenId },
  });
}
