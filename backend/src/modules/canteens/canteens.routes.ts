import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Services } from '../../services.js';
import { createAuthenticate, requireStudent } from '../../middleware/auth.js';
import { id, idParams, parse } from '../../http/validation.js';
import { areaCanteenSelect, defaultCanteenOf } from './service-areas.js';

const canteenParams = z.object({ canteenId: id });
const servicePeriodQuery = z.object({
  period: z.enum(['DAY', 'NIGHT']).optional(),
});

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
    const { period } = parse(servicePeriodQuery, req.query);
    res.json({ data: await services.canteens.menu(req.auth!.principal, canteenId, period) });
  });
  router.get('/:canteenId/categories', async (req, res) => {
    const { canteenId } = parse(canteenParams, req.params);
    res.json({ data: await services.canteens.categories(req.auth!.principal, canteenId) });
  });
  router.get('/:canteenId/payment-config', requireStudent, async (req, res) => {
    const { canteenId } = parse(canteenParams, req.params);
    res.json({ data: await services.canteens.paymentConfig(req.auth!.principal, canteenId) });
  });
  return router;
}

/** /api/menu — single item details. */
export function createMenuRouter(ctx: AppContext, services: Services): Router {
  const router = Router();
  router.use(createAuthenticate(ctx));
  router.get('/items/:id', async (req, res) => {
    const { id: itemId } = parse(idParams, req.params);
    const { period } = parse(servicePeriodQuery, req.query);
    res.json({ data: await services.canteens.item(req.auth!.principal, itemId, period) });
  });
  return router;
}

/** /api/hostels — public list for registration. */
export function createHostelsRouter(ctx: AppContext): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    const hostels = await ctx.prisma.hostel.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        serviceArea: { select: { id: true, name: true, canteens: { select: areaCanteenSelect } } },
      },
      orderBy: { name: 'asc' },
    });
    res.json({
      data: hostels.map((hostel) => {
        const current = defaultCanteenOf(hostel.serviceArea.canteens);
        return {
          id: hostel.id,
          name: hostel.name,
          serviceArea: { id: hostel.serviceArea.id, name: hostel.serviceArea.name },
          canteen: current ? { id: current.id, name: current.name, type: current.type } : null,
        };
      }),
    });
  });
  return router;
}

/**
 * /api/qr-codes/:id — public image of an ACTIVE canteen payment QR.
 * A QR is merchant information printed at the counter, so it is not secret;
 * ids are random UUIDs and a new upload always gets a new id, so responses
 * are immutable and safely cached. Replaced/removed QRs return 404.
 */
export function createQrImageRouter(services: Services): Router {
  const router = Router();
  router.get('/:id', async (req, res) => {
    const { id: qrId } = parse(idParams, req.params);
    const image = await services.qrCodes.qrImage(qrId);
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('Content-Length', String(image.data.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', `"${image.sha256}"`);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Disposition', 'inline');
    res.end(image.data);
  });
  return router;
}

/**
 * /api/service-areas — public directory for registration screens: each
 * service area with its ACTIVE Day/Night canteens (id, name, type only).
 * No availability, staff or payment data.
 */
export function createServiceAreaDirectoryRouter(ctx: AppContext): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    const areas = await ctx.prisma.serviceArea.findMany({
      select: {
        id: true,
        name: true,
        canteens: {
          where: { isActive: true },
          select: { id: true, name: true, type: true },
          orderBy: { type: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
    res.json({ data: areas.filter((area) => area.canteens.length > 0) });
  });
  return router;
}
