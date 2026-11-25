import { randomUUID } from 'node:crypto';
import { areaCanteenSelect, defaultCanteenOf } from '../canteens/service-areas.js';
import { CREDENTIAL_PROVIDER_ID, createIdentity } from './password-accounts.js';
import { canteenAvailability, canteenSelect } from '../canteens/canteen.dto.js';
import type { PrismaClient } from '../../lib/prisma.js';
import type { VerifiedIdentity } from '../../lib/session.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { Outbox, rooms, type EventPublisher } from '../../realtime/events.js';
import { activeAdminRecipients, writeNotifications } from '../notifications/notification.writer.js';
import { isAuthUserRegistered, isAuthUserTaken, type Principal } from './principal.js';
import {
  changeRequestInclude,
  toChangeRequestDto,
} from '../change-requests/change-requests.service.js';

export interface StudentRegistration {
  name: string;
  /** Optional confirmation only: the address always comes from the session. */
  email?: string | undefined;
  hostelId: string;
}

/** Staff self-registration with email + password (no session needed). */
export interface StaffSignUp {
  name: string;
  /** Lower-cased; any address (e.g. a personal Gmail). Not verified. */
  email: string;
  /** Already validated and hashed (password-accounts.ts hashNewPassword). */
  passwordHash: string;
  /** Optional: request access to a canteen immediately. */
  requestedCanteenId?: string | undefined;
}

interface Deps {
  prisma: PrismaClient;
  events: EventPublisher;
}

export function createAuthService({ prisma, events }: Deps) {
  /**
   * The email always comes from the signed-in identity (Google-verified
   * @srmap.edu.in, enforced by Better Auth). A body may only confirm it.
   */
  function verifiedEmail(identity: VerifiedIdentity, claimed: string | undefined): string {
    if (claimed !== undefined && claimed.trim().toLowerCase() !== identity.email) {
      throw new ValidationError(
        'Email does not match the signed-in Google account.',
        undefined,
        'EMAIL_MISMATCH',
      );
    }
    return identity.email;
  }

  async function assertUnregistered(uid: string): Promise<void> {
    if (await isAuthUserRegistered(prisma, uid)) {
      throw new ConflictError('This account is already registered.', 'ALREADY_REGISTERED');
    }
  }

  function translateUniqueError(err: unknown): never {
    if (isAuthUserTaken(err)) {
      throw new ConflictError('This account is already registered.', 'ALREADY_REGISTERED');
    }
    if (isUniqueViolation(err, 'email')) {
      throw new ConflictError('This email is already registered.', 'EMAIL_IN_USE');
    }
    throw err;
  }

  return {
    /** Creates ONLY a Student. No input can produce any other role. */
    async registerStudent(identity: VerifiedIdentity, input: StudentRegistration) {
      // Only verified @srmap.edu.in identities ever get a session (Better Auth).
      const emailAddress = verifiedEmail(identity, input.email);
      await assertUnregistered(identity.uid);

      // A staff/admin address is not a student address (Google refuses it at
      // sign-in; this also covers sessions from before that rule).
      const [staffWithEmail, adminsWithEmail] = await Promise.all([
        prisma.staff.count({ where: { email: emailAddress } }),
        prisma.admin.count({ where: { email: emailAddress } }),
      ]);
      if (staffWithEmail > 0 || adminsWithEmail > 0) {
        throw new ConflictError('This email is already registered.', 'EMAIL_IN_USE');
      }

      const hostel = await prisma.hostel.findUnique({ where: { id: input.hostelId } });
      if (!hostel) throw new ValidationError('Select a valid hostel.', undefined, 'INVALID_HOSTEL');
      if (!hostel.isActive) {
        throw new ValidationError(
          'This hostel is not accepting registrations.',
          undefined,
          'HOSTEL_INACTIVE',
        );
      }

      try {
        await prisma.student.create({
          data: {
            authUserId: identity.uid,
            email: emailAddress,
            name: input.name,
            hostelId: hostel.id,
          },
        });
      } catch (err) {
        translateUniqueError(err);
      }
    },

    /**
     * Staff self-registration: creates a password identity and a PENDING Staff
     * account in one transaction. An admin must approve it and assign a
     * canteen before it can operate anything; the staff member can sign in
     * meanwhile to see that status. No session is created here.
     */
    async signUpStaff(input: StaffSignUp) {
      if (input.requestedCanteenId) {
        const canteen = await prisma.canteen.findUnique({
          where: { id: input.requestedCanteenId },
        });
        if (!canteen || !canteen.isActive) {
          throw new NotFoundError('Canteen not found.', 'CANTEEN_NOT_FOUND');
        }
      }
      // Any account (or sign-in identity) with this address already exists.
      const [identities, students, staffRows, admins] = await Promise.all([
        prisma.authUser.count({ where: { email: input.email } }),
        prisma.student.count({ where: { email: input.email } }),
        prisma.staff.count({ where: { email: input.email } }),
        prisma.admin.count({ where: { email: input.email } }),
      ]);
      if (identities + students + staffRows + admins > 0) {
        throw new ConflictError('This email is already registered.', 'EMAIL_IN_USE');
      }

      const outbox = new Outbox();
      try {
        await prisma.$transaction(async (tx) => {
          const authUserId = await createIdentity(tx, { email: input.email, name: input.name });
          await tx.authAccount.create({
            data: {
              id: randomUUID(),
              userId: authUserId,
              accountId: authUserId,
              providerId: CREDENTIAL_PROVIDER_ID,
              password: input.passwordHash,
            },
          });
          const staff = await tx.staff.create({
            data: { authUserId, email: input.email, name: input.name, status: 'PENDING' },
          });
          if (input.requestedCanteenId) {
            const request = await tx.canteenChangeRequest.create({
              data: { staffId: staff.id, requestedCanteenId: input.requestedCanteenId },
              include: changeRequestInclude,
            });
            await writeNotifications(tx, outbox, await activeAdminRecipients(tx), {
              type: 'STAFF_ACCESS_REQUESTED',
              title: 'New staff access request',
              message: `${staff.name} requested access to ${request.requestedCanteen.name}.`,
              data: { changeRequestId: request.id, staffId: staff.id },
            });
            outbox.emit('change_request.created', [rooms.admins()], {
              changeRequest: toChangeRequestDto(request),
            });
          }
        });
      } catch (err) {
        translateUniqueError(err);
      }
      outbox.flush(events);
    },

    /** Current user as stored in PostgreSQL. */
    async me(identity: VerifiedIdentity, principal: Principal | null) {
      if (!principal) {
        return {
          registered: false as const,
          role: null,
          authUserId: identity.uid,
          email: identity.email,
        };
      }
      const base = {
        registered: true as const,
        role: principal.role,
        id: principal.id,
        authUserId: principal.authUserId,
        name: principal.name,
        email: principal.email,
        isActive: principal.isActive,
      };
      if (principal.role === 'STUDENT') {
        const student = await prisma.student.findUniqueOrThrow({
          where: { id: principal.id },
          select: {
            hostel: {
              select: {
                id: true,
                name: true,
                serviceArea: {
                  select: { id: true, name: true, canteens: { select: areaCanteenSelect } },
                },
              },
            },
          },
        });
        // The area's canteen taking orders now, else its default (see defaultCanteenOf).
        const current = defaultCanteenOf(student.hostel.serviceArea.canteens);
        return {
          ...base,
          hostel: { id: student.hostel.id, name: student.hostel.name },
          serviceArea: { id: student.hostel.serviceArea.id, name: student.hostel.serviceArea.name },
          defaultCanteen: current
            ? {
                id: current.id,
                name: current.name,
                type: current.type,
                isActive: current.isActive,
                isAcceptingOrders: current.isAcceptingOrders,
                isPaused: current.isPaused,
              }
            : null,
        };
      }
      if (principal.role === 'STAFF') {
        const staff = await prisma.staff.findUniqueOrThrow({
          where: { id: principal.id },
          select: {
            status: true,
            canteen: { select: canteenSelect },
            assignments: {
              select: {
                canteenId: true,
                canteen: {
                  select: {
                    id: true,
                    name: true,
                    type: true,
                    isActive: true,
                    isAcceptingOrders: true,
                    isPaused: true,
                  },
                },
                capabilities: { select: { capability: true }, orderBy: { capability: 'asc' } },
              },
              orderBy: { createdAt: 'asc' },
            },
            changeRequests: {
              where: { status: 'PENDING' },
              select: {
                id: true,
                status: true,
                createdAt: true,
                requestedCanteen: { select: { id: true, name: true } },
              },
            },
          },
        });
        return {
          ...base,
          status: staff.status,
          // Same computed availability as the dashboard, so every staff screen
          // names the canteen's state the same way.
          canteen: staff.canteen
            ? {
                id: staff.canteen.id,
                name: staff.canteen.name,
                type: staff.canteen.type,
                isActive: staff.canteen.isActive,
                isAcceptingOrders: staff.canteen.isAcceptingOrders,
                isPaused: staff.canteen.isPaused,
                availability: canteenAvailability(staff.canteen),
              }
            : null,
          assignments: staff.assignments.map((row) => ({
            canteenId: row.canteenId,
            canteen: row.canteen,
            capabilities: row.capabilities.map((entry) => entry.capability),
          })),
          pendingChangeRequest: staff.changeRequests[0] ?? null,
        };
      }
      return base;
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
