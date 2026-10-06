import { z } from 'zod';

/** The frozen contract lives in packages/contracts (shared with the web apps). */
export * from '@serve/contracts';

/** Asserts a value matches a schema, with a readable failure. */
export function expectShape<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Contract mismatch:\n${z.prettifyError(result.error)}\nvalue: ${JSON.stringify(value, null, 2)}`,
    );
  }
  return result.data;
}
