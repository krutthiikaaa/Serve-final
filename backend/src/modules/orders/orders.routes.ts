import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Services } from '../../services.js';
import { createAuthenticate, currentStudent, requireStudent } from '../../middleware/auth.js';
import { sensitiveLimiter } from '../../middleware/rate-limit.js';
import { id, idParams, paginationQuery, parse, quantity } from '../../http/validation.js';

/**
 * Cart/order body. Only ids and quantities are accepted — unknown fields
 * (price, lineTotal, total, studentId, …) are stripped and never read.
 */
export const cartBody = z.object({
  canteenId: id,
  items: z
    .array(z.object({ menuItemId: id, quantity }))
    .min(1, { error: 'Add at least one item' })
    .max(50, { error: 'Too many different items' }),
});

const listQuery = paginationQuery.extend({
  status: z.enum(['active', 'past', 'all']).default('all'),
});

/** /api/cart — server-side quote (students). */
export function createCartRouter(ctx: AppContext, services: Services): Router {
  const router = Router();
  router.use(createAuthenticate(ctx), requireStudent);
  router.post('/quote', async (req, res) => {
    res.json({ data: await services.orders.quote(parse(cartBody, req.body)) });
  });
  return router;
}

/** /api/orders — the student's own orders. */
export function createOrdersRouter(ctx: AppContext, services: Services): Router {
  const router = Router();
  router.use(createAuthenticate(ctx), requireStudent);

  router.post('/', sensitiveLimiter(ctx.env), async (req, res) => {
    const result = await services.orders.create(
      currentStudent(req),
      req.header('Idempotency-Key'),
      parse(cartBody, req.body),
    );
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(result.replayed ? 200 : 201).json({ data: result.order });
  });

  router.get('/', async (req, res) => {
    const query = parse(listQuery, req.query);
    res.json(await services.orders.listForStudent(currentStudent(req), query.status, query));
  });

  router.get('/:id', async (req, res) => {
    const { id: orderId } = parse(idParams, req.params);
    res.json({ data: await services.orders.getForStudent(currentStudent(req), orderId) });
  });

  router.post('/:id/cancel', async (req, res) => {
    const { id: orderId } = parse(idParams, req.params);
    res.json({ data: await services.orders.cancelByStudent(currentStudent(req), orderId) });
  });

  return router;
}
