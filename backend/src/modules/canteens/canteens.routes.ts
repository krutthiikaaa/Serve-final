import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Services } from '../../services.js';
import { createAuthenticate } from '../../middleware/auth.js';
import { id, idParams, parse } from '../../http/validation.js';

const canteenParams = z.object({ canteenId: id });

/** /api/canteens — browsing. Any authenticated user; visibility enforced by the service. */
export function createCanteensRouter(ctx: AppContext, services: Services): Router {
  const router = Router();
  router.use(createAuthenticate(ctx));

  router.get('/', async (req, res) => {
    res.json({ data: await services.canteens.list(req.auth!.principal) });
  });
  router.get('/:id', async (req, res) => {
    const { id: canteenId } = parse(idParams, req.params);
    res.json({ data: await services.canteens.get(req.auth!.principal, canteenId) });
  });
  router.get('/:canteenId/menu', async (req, res) => {
    const { canteenId } = parse(canteenParams, req.params);
    res.json({ data: await services.canteens.menu(req.auth!.principal, canteenId) });
  });
  router.get('/:canteenId/categories', async (req, res) => {
    const { canteenId } = parse(canteenParams, req.params);
    res.json({ data: await services.canteens.categories(req.auth!.principal, canteenId) });
  });
  return router;
}

/** /api/menu — single item details. */
export function createMenuRouter(ctx: AppContext, services: Services): Router {
  const router = Router();
  router.use(createAuthenticate(ctx));
  router.get('/items/:id', async (req, res) => {
    const { id: itemId } = parse(idParams, req.params);
    res.json({ data: await services.canteens.item(req.auth!.principal, itemId) });
  });
  return router;
}

/** /api/hostels — public list for registration. */
export function createHostelsRouter(ctx: AppContext): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    const hostels = await ctx.prisma.hostel.findMany({
      where: { isActive: true },
      select: { id: true, name: true, canteen: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ data: hostels });
  });
  return router;
}
