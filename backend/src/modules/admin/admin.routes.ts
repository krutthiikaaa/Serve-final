import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Services } from '../../services.js';
import { createAuthenticate, currentAdmin, requireAdmin } from '../../middleware/auth.js';
import {
  httpsUrl,
  id,
  idParams,
  name,
  optionalText,
  paginationQuery,
  parse,
  scheduleOverride,
  servicePeriod,
  staffCapability,
  upiVpa,
} from '../../http/validation.js';
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
const canteenBody = z.strictObject({
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
const hostelBody = z.strictObject({ name, canteenId: id });
const hostelPatch = z
  .strictObject({
    name: name.optional(),
    canteenId: id.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    error: 'Nothing to update',
  });
const staffQuery = paginationQuery.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'DEACTIVATED']).optional(),
  canteenId: id.optional(),
  capability: staffCapability.optional(),
});
const reportDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Use a YYYY-MM-DD date' });
const reportQuery = z.strictObject({
  from: reportDay.optional(),
  to: reportDay.optional(),
  canteenId: id.optional(),
  servicePeriod: servicePeriod.optional(),
  channel: z.enum(['APP', 'WALK_IN']).optional(),
  paymentMethod: z.enum(['CASH', 'UPI']).optional(),
  paymentMode: z.enum(['DEMO', 'LIVE']).optional(),
});
const requestQuery = paginationQuery.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});
const reviewBody = z.strictObject({ notes: optionalText(500) });
const orderQuery = paginationQuery.extend({
  canteenId: id.optional(),
  status: z
    .enum(['PLACED', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED'])
    .optional(),
});
const canteenParams = z.object({ canteenId: id });
const periodParams = z.object({ id, period: servicePeriod });
const weekday = z.number({ error: 'Weekday must be an integer' }).int();
const minutes = z.number({ error: 'Minutes must be an integer' }).int();
const servicePricePaise = z
  .number({ error: 'Must be an integer number of paise' })
  .int({ error: 'Must be an integer number of paise' })
  .positive({ error: 'Price must be greater than 0' });

const canteenServicesBody = z.strictObject({
  services: z
    .array(
      z.strictObject({
        period: servicePeriod,
        isEnabled: z.boolean(),
        override: scheduleOverride,
      }),
    )
    .min(1, { error: 'Provide at least one service' }),
});
const serviceScheduleBody = z.strictObject({
  schedules: z.array(
    z.strictObject({
      weekday,
      opensAtMinutes: minutes,
      closesAtMinutes: minutes,
    }),
  ),
});
const menuItemServicesBody = z.strictObject({
  services: z
    .array(
      z.strictObject({
        period: servicePeriod,
        pricePaise: servicePricePaise,
        isAvailable: z.boolean(),
      }),
    )
    .min(1, { error: 'Provide at least one service price' }),
});
const nullableHttpsUrl = z.union([z.literal('').transform(() => null), httpsUrl, z.null()]).optional();
const nullableUpiVpa = z.union([z.literal('').transform(() => null), upiVpa, z.null()]).optional();
const paymentConfigBody = z.strictObject({
  mode: z.enum(['DEMO', 'LIVE']).optional(),
  upiVpa: nullableUpiVpa,
  merchantName: optionalText(120),
  qrImageUrl: nullableHttpsUrl,
  qrStorageKey: optionalText(512),
  instructions: optionalText(500),
  isActive: z.boolean().optional(),
});
const staffAssignmentsBody = z.strictObject({
  primaryCanteenId: id,
  assignments: z
    .array(
      z.strictObject({
        canteenId: id,
        capabilities: z.array(staffCapability),
      }),
    )
    .min(1, { error: 'Provide at least one canteen assignment' }),
});

/** /api/admin — platform administration. Admin role required (PostgreSQL). */
export function createAdminRouter(ctx: AppContext, services: Services): Router {
  const router = Router();
  router.use(createAuthenticate(ctx), requireAdmin);
  const admin = services.admin;

  router.get('/dashboard', async (_req, res) => {
    res.json({ data: await admin.dashboard() });
  });
  router.get('/payments', async (_req, res) => {
    res.json({ data: await admin.paymentOverview() });
  });
  router.get('/reports', async (req, res) => {
    res.json({ data: await admin.reports(parse(reportQuery, req.query)) });
  });
  router.get('/settings', async (_req, res) => {
    res.json({ data: admin.settings() });
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
  router.put('/canteens/:id/services', async (req, res) => {
    const { id: canteenId } = parse(idParams, req.params);
    const { services } = parse(canteenServicesBody, req.body);
    res.json({
      data: await admin.updateCanteenServices(currentAdmin(req), canteenId, services),
    });
  });
  router.put('/canteens/:id/services/:period/schedule', async (req, res) => {
    const { id: canteenId, period } = parse(periodParams, req.params);
    const { schedules } = parse(serviceScheduleBody, req.body);
    res.json({
      data: await admin.updateCanteenServiceSchedule(
        currentAdmin(req),
        canteenId,
        period,
        schedules,
      ),
    });
  });
  router.get('/canteens/:id/payment-config', async (req, res) => {
    res.json({ data: await admin.getPaymentConfig(parse(idParams, req.params).id) });
  });
  router.put('/canteens/:id/payment-config', async (req, res) => {
    res.json({
      data: await admin.updatePaymentConfig(
        currentAdmin(req),
        parse(idParams, req.params).id,
        parse(paymentConfigBody, req.body ?? {}),
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
    const { canteenId } = parse(z.strictObject({ canteenId: id }), req.body);
    res.json({
      data: await admin.assignStaff(currentAdmin(req), parse(idParams, req.params).id, canteenId),
    });
  });
  router.put('/staff/:id/assignments', async (req, res) => {
    res.json({
      data: await admin.updateStaffAssignments(
        currentAdmin(req),
        parse(idParams, req.params).id,
        parse(staffAssignmentsBody, req.body),
      ),
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
  router.get('/canteens/:canteenId/menu/catalogue', async (req, res) => {
    res.json({
      data: await services.menu.adminCatalogue(parse(canteenParams, req.params).canteenId),
    });
  });
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
  router.put('/menu/items/:id/services', async (req, res) => {
    const { id: itemId } = parse(idParams, req.params);
    const { services } = parse(menuItemServicesBody, req.body);
    res.json({
      data: await admin.updateMenuItemServices(currentAdmin(req), itemId, services),
    });
  });

  return router;
}
