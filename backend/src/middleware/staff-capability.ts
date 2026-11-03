import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import type { StaffCapability } from '../generated/prisma/client.js';
import type { PrismaClient } from '../lib/prisma.js';
import { ForbiddenError } from '../lib/errors.js';
import { currentApprovedStaff } from './auth.js';
import { staffHasCapability } from '../modules/staff/assignments.js';
import { id, parse } from '../http/validation.js';

const canteenQuery = z.object({ canteenId: id.optional() });

/**
 * Resolve the canteen this staff request operates on.
 *
 * Defaults to Staff.canteenId (primary). A client may send `?canteenId=`;
 * that value is used only after PostgreSQL confirms an assignment row.
 */
export function resolveStaffCanteen(prisma: PrismaClient): RequestHandler {
  return async (req, _res, next) => {
    const staff = currentApprovedStaff(req);
    const requested = parse(canteenQuery, req.query).canteenId;
    const canteenId = requested ?? staff.canteenId;
    const assignment = await prisma.staffCanteenAssignment.findUnique({
      where: { staffId_canteenId: { staffId: staff.id, canteenId } },
      select: { id: true },
    });
    if (!assignment) {
      throw new ForbiddenError(
        'You are not assigned to this canteen.',
        'CANTEEN_NOT_ASSIGNED',
      );
    }
    req.staffCanteenId = canteenId;
    next();
  };
}

export function staffOperatingCanteenId(req: Request): string {
  return req.staffCanteenId ?? currentApprovedStaff(req).canteenId;
}

/**
 * Capability check for approved staff on the resolved operating canteen.
 *
 * Order of gates (enforced by route mounting):
 *   1. Firebase authentication
 *   2. `requireApprovedStaff`
 *   3. `resolveStaffCanteen` (assignment row)
 *   4. the named capability on that assignment
 */
export function requireStaffCapability(
  prisma: PrismaClient,
  capability: StaffCapability,
): RequestHandler {
  return async (req, _res, next) => {
    const staff = currentApprovedStaff(req);
    const canteenId = staffOperatingCanteenId(req);
    const allowed = await staffHasCapability(prisma, staff.id, canteenId, capability);
    if (!allowed) {
      throw new ForbiddenError(
        'You do not have permission to perform this action on this canteen.',
        'FORBIDDEN_CAPABILITY',
      );
    }
    next();
  };
}

export function requireAnyStaffCapability(
  prisma: PrismaClient,
  capabilities: readonly StaffCapability[],
): RequestHandler {
  return async (req, _res, next) => {
    const staff = currentApprovedStaff(req);
    const canteenId = staffOperatingCanteenId(req);
    for (const capability of capabilities) {
      if (await staffHasCapability(prisma, staff.id, canteenId, capability)) {
        next();
        return;
      }
    }
    throw new ForbiddenError(
      'You do not have permission to perform this action on this canteen.',
      'FORBIDDEN_CAPABILITY',
    );
  };
}
