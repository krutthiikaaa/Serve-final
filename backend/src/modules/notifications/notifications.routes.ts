import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Services } from '../../services.js';
import { createAuthenticate, currentPrincipal, requireRegistered } from '../../middleware/auth.js';
import { idParams, paginationQuery, parse } from '../../http/validation.js';

const listQuery = paginationQuery.extend({
  unread: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

/** /api/notifications — the caller's own notifications (any role). */
export function createNotificationsRouter(ctx: AppContext, services: Services): Router {
  const router = Router();
  router.use(createAuthenticate(ctx), requireRegistered);

  router.get('/', async (req, res) => {
    const query = parse(listQuery, req.query);
    res.json(
      await services.notifications.list(currentPrincipal(req), {
        unreadOnly: query.unread,
        page: query,
      }),
    );
  });
  router.patch('/read-all', async (req, res) => {
    res.json({ data: await services.notifications.markAllRead(currentPrincipal(req)) });
  });
  router.patch('/:id/read', async (req, res) => {
    res.json({
      data: await services.notifications.markRead(
        currentPrincipal(req),
        parse(idParams, req.params).id,
      ),
    });
  });
  return router;
}
