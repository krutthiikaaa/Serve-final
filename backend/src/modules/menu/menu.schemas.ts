import { z } from 'zod';
import { id, imageUrl, name, optionalText, pricePaise } from '../../http/validation.js';

const sortOrder = z.number().int().min(0).max(10_000);

export const createCategoryBody = z.strictObject({ name, sortOrder: sortOrder.optional() });
export const updateCategoryBody = z
  .strictObject({
    name: name.optional(),
    sortOrder: sortOrder.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    error: 'Nothing to update',
  });

export const createItemBody = z.strictObject({
  categoryId: id,
  name,
  description: optionalText(500),
  pricePaise,
  imageUrl,
  isAvailable: z.boolean().optional(),
});
export const updateItemBody = z
  .strictObject({
    categoryId: id.optional(),
    name: name.optional(),
    description: optionalText(500),
    pricePaise: pricePaise.optional(),
    imageUrl,
    isAvailable: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    error: 'Nothing to update',
  });
export const availabilityBody = z.strictObject({ isAvailable: z.boolean() });
export const priceBody = z.strictObject({ pricePaise });
