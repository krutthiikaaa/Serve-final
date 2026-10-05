import { Prisma } from '../generated/prisma/client.js';

/** True when `err` is a unique-constraint violation, optionally on a named constraint/field. */
export function isUniqueViolation(err: unknown, target?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  if (!target) return true;
  return JSON.stringify(err.meta ?? {}).includes(target) || err.message.includes(target);
}
