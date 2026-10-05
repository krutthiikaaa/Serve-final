import { z } from 'zod';

/** Parse untrusted input; a ZodError becomes 422 VALIDATION_ERROR in the error handler. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

export const id = z.uuid({ error: 'Must be a valid id' });

export const idParams = z.object({ id });

export const name = z
  .string()
  .trim()
  .min(1, { error: 'Required' })
  .max(120, { error: 'Must be at most 120 characters' });

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Must be a valid email address' }));

/** Price in integer paise: ₹1 – ₹10,000. */
export const pricePaise = z
  .number({ error: 'Must be an integer number of paise' })
  .int({ error: 'Must be an integer number of paise' })
  .min(100, { error: 'Must be at least 100 paise (₹1)' })
  .max(1_000_000, { error: 'Must be at most ₹10,000 (1000000 paise)' });

export const quantity = z
  .number({ error: 'Quantity must be a whole number' })
  .int({ error: 'Quantity must be a whole number' })
  .min(1, { error: 'Quantity must be at least 1' })
  .max(20, { error: 'Quantity must be at most 20' });

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Must be at most ${max} characters` })
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

export const imageUrl = z
  .url({ protocol: /^https?$/, error: 'Must be an http(s) URL' })
  .max(2048)
  .nullable()
  .optional();

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.uuid({ error: 'Invalid cursor' }).optional(),
});

export type Pagination = z.infer<typeof paginationQuery>;

/** Prisma args for keyset pagination on (createdAt desc, id desc). */
export function pageArgs(page: Pagination) {
  return {
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
  };
}

export function toPage<T extends { id: string }>(rows: T[], page: Pagination) {
  const hasMore = rows.length > page.limit;
  const data = hasMore ? rows.slice(0, page.limit) : rows;
  return { data, nextCursor: hasMore ? (data[data.length - 1]?.id ?? null) : null };
}
