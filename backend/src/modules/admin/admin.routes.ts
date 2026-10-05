import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Services } from '../../services.js';
import { createAuthenticate, currentAdmin, requireAdmin } from '../../middleware/auth.js';
import { id, idParams, name, optionalText, paginationQuery, parse } from '../../http/validation.js';
import {
  availabilityBody,
  createCategoryBody,
  createItemBody,
  priceBody,
  updateCategoryBody,
  updateItemBody,
} from '../menu/menu.schemas.js';

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: 'Use lowercase letters, digits and hyphens' })
  .max(80);
const canteenBody = z.object({
  name,
  slug: slug.optional(),
  location: optionalText(200),
  openingHours: optionalText(100),
  isActive: z.boolean().optional(),
  isAcceptingOrders: z.boolean().optional(),
});
const canteenPatch = canteenBody
  .partial()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    error: 'Nothing to update',
  });
const hostelBody = z.object({ name, canteenId: id });
const hostelPatch = z
  .object({ name: name.optional(), canteenId: id.optional(), isActive: z.boolean().optional() })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    error: 'Nothing to update',
  });
const staffQuery = paginationQuery.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'DEACTIVATED']).optional(),
  canteenId: id.optional(),
});
const requestQuery = paginationQuery.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});
const reviewBody = z.object({ notes: optionalText(500) });
const orderQuery = paginationQuery.extend({
  canteenId: id.optional(),
  status: z
    .enum(['PLACED', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED'])
    .optional(),
});
const canteenParams = z.object({ canteenId: id });

/** /api/admin — platform administration. Admin role required (PostgreSQL). */
export function createAdminRouter(ctx: AppContext, services: Services): Router {
  const router = Router();
  router.use(createAuthenticate(ctx), requireAdmin);
  const admin = services.admin;

  router.get('/dashboard', async (_req, res) => {
    res.json({ data: await admin.dashboard() });
  });

  // Canteens
  router.get('/canteens', async (_req, res) => {
    res.json({ data: await admin.listCanteens() });
  });
  router.post('/canteens', async (req, res) => {
    res.status(201).json({ data: await admin.createCanteen(parse(canteenBody, req.body)) });
  });
  router.get('/canteens/:id', async (req, res) => {
    res.json({ data: await admin.getCanteen(parse(idParams, req.params).id) });
  });
  router.patch('/canteens/:id', async (req, res) => {
    res.json({
      data: await admin.updateCanteen(
        parse(idParams, req.params).id,
        parse(canteenPatch, req.body),
      ),
    });
  });

  // Hostels
  router.get('/hostels', async (_req, res) => {
    res.json({ data: await admin.listHostels() });
  });
  router.post('/hostels', async (req, res) => {
    res.status(201).json({ data: await admin.createHostel(parse(hostelBody, req.body)) });
  });
  router.patch('/hostels/:id', async (req, res) => {
    res.json({
      data: await admin.updateHostel(parse(idParams, req.params).id, parse(hostelPatch, req.body)),
    });
  });

  // Staff
  router.get('/staff', async (req, res) => {
    const query = parse(staffQuery, req.query);
    res.json(await admin.listStaff(query, query));
  });
  router.get('/staff/:id', async (req, res) => {
    res.json({ data: await admin.getStaff(parse(idParams, req.params).id) });
  });
  router.patch('/staff/:id/assignment', async (req, res) => {
    const { canteenId } = parse(z.object({ canteenId: id }), req.body);
    res.json({
      data: await admin.assignStaff(currentAdmin(req), parse(idParams, req.params).id, canteenId),
    });
  });
  router.post('/staff/:id/deactivate', async (req, res) => {
    res.json({
      data: await admin.deactivateStaff(currentAdmin(req), parse(idParams, req.params).id),
    });
  });

  // Change requests
  router.get('/change-requests', async (req, res) => {
    const query = parse(requestQuery, req.query);
    res.json(await services.changeRequests.listForAdmin(query.status, query));
  });
  router.post('/change-requests/:id/approve', async (req, res) => {
    const { notes } = parse(reviewBody, req.body ?? {});
    res.json({
      data: await services.changeRequests.review(
        currentAdmin(req),
        parse(idParams, req.params).id,
        'APPROVED',
        notes,
      ),
    });
  });
  router.post('/change-requests/:id/reject', async (req, res) => {
    const { notes } = parse(reviewBody, req.body ?? {});
    res.json({
      data: await services.changeRequests.review(
        currentAdmin(req),
        parse(idParams, req.params).id,
        'REJECTED',
        notes,
      ),
    });
  });

  // Orders (read-only; no status override is implemented)
  router.get('/orders', async (req, res) => {
    const query = parse(orderQuery, req.query);
    res.json(await services.orders.listForAdmin(query, query));
  });
  router.get('/orders/:id', async (req, res) => {
    res.json({ data: await services.orders.getForAdmin(parse(idParams, req.params).id) });
  });

  // Menu management for any canteen
  const adminScope = { admin: true as const };
  router.get('/canteens/:canteenId/menu', async (req, res) => {
    res.json({ data: await services.menu.managedMenu(parse(canteenParams, req.params).canteenId) });
  });
  router.post('/canteens/:canteenId/menu/categories', async (req, res) => {
    const { canteenId } = parse(canteenParams, req.params);
    res.status(201).json({
      data: await services.menu.createCategory(canteenId, parse(createCategoryBody, req.body)),
    });
  });
  router.patch('/menu/categories/:id', async (req, res) => {
    res.json({
      data: await services.menu.updateCategory(
        adminScope,
        parse(idParams, req.params).id,
        parse(updateCategoryBody, req.body),
      ),
    });
  });
  router.post('/canteens/:canteenId/menu/items', async (req, res) => {
    const { canteenId } = parse(canteenParams, req.params);
    res
      .status(201)
      .json({ data: await services.menu.createItem(canteenId, parse(createItemBody, req.body)) });
  });
  router.patch('/menu/items/:id', async (req, res) => {
    res.json({
      data: await services.menu.updateItem(
        adminScope,
        parse(idParams, req.params).id,
        parse(updateItemBody, req.body),
      ),
    });
  });
  router.patch('/menu/items/:id/price', async (req, res) => {
    res.json({
      data: await services.menu.updateItem(
        adminScope,
        parse(idParams, req.params).id,
        parse(priceBody, req.body),
      ),
    });
  });
  router.patch('/menu/items/:id/availability', async (req, res) => {
    res.json({
      data: await services.menu.updateItem(
        adminScope,
        parse(idParams, req.params).id,
        parse(availabilityBody, req.body),
      ),
    });
  });

  return router;
}
