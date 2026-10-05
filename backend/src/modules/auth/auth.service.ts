import type { Env } from '../../config/env.js';
import type { PrismaClient } from '../../lib/prisma.js';
import type { VerifiedIdentity } from '../../lib/firebase.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { Outbox, rooms, type EventPublisher } from '../../realtime/events.js';
import { activeAdminRecipients, writeNotifications } from '../notifications/notification.writer.js';
import { isFirebaseUidRegistered, type Principal } from './principal.js';

export interface StudentRegistration {
  name: string;
  email: string;
  hostelId: string;
}

export interface StaffRegistration {
  name: string;
  email: string;
  /** Optional: request access to a canteen immediately. */
  requestedCanteenId?: string | undefined;
}

interface Deps {
  prisma: PrismaClient;
  env: Pick<Env, 'STUDENT_EMAIL_DOMAINS'>;
  events: EventPublisher;
}

export function createAuthService({ prisma, env, events }: Deps) {
  /** The email must come from the verified Firebase token; the body may only confirm it. */
  function verifiedEmail(identity: VerifiedIdentity, claimed: string): string {
    if (!identity.email) {
      throw new ValidationError(
        'Your Firebase account has no email address.',
        undefined,
        'EMAIL_REQUIRED',
      );
    }
    if (identity.email !== claimed) {
      throw new ValidationError(
        'Email does not match the signed-in Firebase account.',
        undefined,
        'EMAIL_MISMATCH',
      );
    }
    return identity.email;
  }

  async function assertUnregistered(uid: string): Promise<void> {
    if (await isFirebaseUidRegistered(prisma, uid)) {
      throw new ConflictError('This account is already registered.', 'ALREADY_REGISTERED');
    }
  }

  function translateUniqueError(err: unknown): never {
    if (isUniqueViolation(err, 'firebaseUid')) {
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
      const emailAddress = verifiedEmail(identity, input.email);

      const allowed = env.STUDENT_EMAIL_DOMAINS;
      if (allowed.length > 0) {
        const domain = emailAddress.split('@')[1] ?? '';
        if (!allowed.includes(domain)) {
          throw new ForbiddenError(
            'Registration is limited to university email addresses.',
            'EMAIL_DOMAIN_NOT_ALLOWED',
          );
        }
      }

      await assertUnregistered(identity.uid);

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
            firebaseUid: identity.uid,
            email: emailAddress,
            name: input.name,
            hostelId: hostel.id,
          },
        });
      } catch (err) {
        translateUniqueError(err);
      }
    },

    /** Creates a PENDING Staff account; an admin must approve and assign a canteen. */
    async registerStaff(identity: VerifiedIdentity, input: StaffRegistration) {
      const emailAddress = verifiedEmail(identity, input.email);
      await assertUnregistered(identity.uid);

      if (input.requestedCanteenId) {
        const canteen = await prisma.canteen.findUnique({
          where: { id: input.requestedCanteenId },
        });
        if (!canteen || !canteen.isActive) {
          throw new NotFoundError('Canteen not found.', 'CANTEEN_NOT_FOUND');
        }
      }

      const outbox = new Outbox();
      try {
        await prisma.$transaction(async (tx) => {
          const staff = await tx.staff.create({
            data: { firebaseUid: identity.uid, email: emailAddress, name: input.name },
          });
          if (input.requestedCanteenId) {
            const request = await tx.canteenChangeRequest.create({
              data: { staffId: staff.id, requestedCanteenId: input.requestedCanteenId },
              include: { requestedCanteen: { select: { id: true, name: true } } },
            });
            await writeNotifications(tx, outbox, await activeAdminRecipients(tx), {
              type: 'STAFF_ACCESS_REQUESTED',
              title: 'New staff access request',
              message: `${staff.name} requested access to ${request.requestedCanteen.name}.`,
              data: { changeRequestId: request.id, staffId: staff.id },
            });
            outbox.emit('change_request:created', [rooms.admins()], {
              changeRequest: {
                id: request.id,
                status: request.status,
                staff: { id: staff.id, name: staff.name, email: staff.email },
                requestedCanteen: request.requestedCanteen,
                fromCanteen: null,
                createdAt: request.createdAt,
              },
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
          firebaseUid: identity.uid,
          email: identity.email,
        };
      }
      const base = {
        registered: true as const,
        role: principal.role,
        id: principal.id,
        firebaseUid: principal.firebaseUid,
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
                canteen: {
                  select: { id: true, name: true, isActive: true, isAcceptingOrders: true },
                },
              },
            },
          },
        });
        return {
          ...base,
          hostel: { id: student.hostel.id, name: student.hostel.name },
          defaultCanteen: student.hostel.canteen,
        };
      }
      if (principal.role === 'STAFF') {
        const staff = await prisma.staff.findUniqueOrThrow({
          where: { id: principal.id },
          select: {
            status: true,
            canteen: { select: { id: true, name: true, isActive: true, isAcceptingOrders: true } },
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
          canteen: staff.canteen,
          pendingChangeRequest: staff.changeRequests[0] ?? null,
        };
      }
      return base;
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
