import { Prisma } from '../generated/prisma/client.js';

/**
 * True when `err` is a unique-constraint violation, optionally on a
 * constraint/index whose name contains `target` (e.g. "Canteen_name_key").
 *
 * Only the violated constraint is inspected — never the whole error — so a
 * target like "name" cannot accidentally match Prisma's `modelName` key.
 * With the pg driver adapter, PostgreSQL reports the index name only.
 */
export function isUniqueViolation(err: unknown, target?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  if (!target) return true;
  return violatedConstraints(err).some((name) => name.includes(target));
}

function violatedConstraints(err: Prisma.PrismaClientKnownRequestError): string[] {
  const meta = (err.meta ?? {}) as {
    target?: string | string[];
    driverAdapterError?: {
      cause?: { constraint?: { index?: string; fields?: string[] } };
    };
  };
  const names: string[] = [];
  if (typeof meta.target === 'string') names.push(meta.target);
  if (Array.isArray(meta.target)) names.push(...meta.target);
  const constraint = meta.driverAdapterError?.cause?.constraint;
  if (constraint?.index) names.push(constraint.index);
  if (constraint?.fields) names.push(...constraint.fields);
  const fromMessage = /constraint: `([^`]+)`/.exec(err.message)?.[1];
  if (fromMessage) names.push(fromMessage);
  return names;
}
