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
 * Resolve the canteen this staff request operates on: always the account's
 * own Staff.canteenId from PostgreSQL. Staff accounts are dedicated to one
 * canteen, so a `?canteenId=` naming any other canteen is refused (403) —
 * there is no canteen switching, and client-supplied ids are never trusted.
 */
export function resolveStaffCanteen(prisma: PrismaClient): RequestHandler {
  return async (req, _res, next) => {
    const staff = currentApprovedStaff(req);
    const requested = parse(canteenQuery, req.query).canteenId;
    if (requested && requested !== staff.canteenId) {
      throw new ForbiddenError('You are not assigned to this canteen.', 'CANTEEN_NOT_ASSIGNED');
    }
    const canteenId = staff.canteenId;
    const assignment = await prisma.staffCanteenAssignment.findUnique({
      where: { staffId_canteenId: { staffId: staff.id, canteenId } },
      select: { id: true },
    });
    if (!assignment) {
      throw new ForbiddenError('You are not assigned to this canteen.', 'CANTEEN_NOT_ASSIGNED');
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
 *   1. Better Auth session (Google, @srmap.edu.in)
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
