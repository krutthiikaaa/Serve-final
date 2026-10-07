import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Services } from '../../services.js';
import {
  createAuthenticate,
  currentApprovedStaff,
  currentStaff,
  requireApprovedStaff,
  requireStaff,
} from '../../middleware/auth.js';
import { id, idParams, optionalText, paginationQuery, parse } from '../../http/validation.js';
import { STAFF_SETTABLE_STATUSES } from '../orders/order-state.js';
import {
  availabilityBody,
  createCategoryBody,
  createItemBody,
  priceBody,
  updateCategoryBody,
  updateItemBody,
} from '../menu/menu.schemas.js';

const orderListQuery = paginationQuery.extend({
  status: z
    .enum(['active', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED'])
    .optional(),
});
const statusBody = z.strictObject({
  status: z.enum(STAFF_SETTABLE_STATUSES),
  reason: optionalText(200),
});
const changeRequestBody = z.strictObject({ requestedCanteenId: id, notes: optionalText(500) });

/**
 * /api/staff — canteen operations. The canteen is ALWAYS the one assigned to
 * the authenticated staff member in PostgreSQL; no route accepts a canteen id
 * for authorization.
 */
export function createStaffRouter(ctx: AppContext, services: Services): Router {
  const router = Router();
  router.use(createAuthenticate(ctx), requireStaff);

  // Change requests: available to pending/rejected/approved staff.
  router.post('/change-requests', async (req, res) => {
    const body = parse(changeRequestBody, req.body);
    res.status(201).json({ data: await services.changeRequests.create(currentStaff(req), body) });
  });
  router.get('/change-requests', async (req, res) => {
    res.json(
      await services.changeRequests.listForStaff(
        currentStaff(req),
        parse(paginationQuery, req.query),
      ),
    );
  });

  // Everything below requires an approved staff member with a canteen.
  router.use(requireApprovedStaff);
  const scope = (req: Parameters<typeof currentApprovedStaff>[0]) => ({
    canteenId: currentApprovedStaff(req).canteenId,
  });

  router.get('/dashboard', async (req, res) => {
    res.json({ data: await services.staff.dashboard(currentApprovedStaff(req)) });
  });
  router.patch('/canteen/status', async (req, res) => {
    const { isAcceptingOrders } = parse(
      z.strictObject({ isAcceptingOrders: z.boolean() }),
      req.body,
    );
    res.json({
      data: await services.staff.setAcceptingOrders(currentApprovedStaff(req), isAcceptingOrders),
    });
  });

  // Orders
  router.get('/orders', async (req, res) => {
    const query = parse(orderListQuery, req.query);
    res.json(
      await services.orders.listForCanteen(
        currentApprovedStaff(req).canteenId,
        query.status,
        query,
      ),
    );
  });
  router.get('/orders/:id', async (req, res) => {
    const { id: orderId } = parse(idParams, req.params);
    res.json({
      data: await services.orders.getForCanteen(currentApprovedStaff(req).canteenId, orderId),
    });
  });
  router.patch('/orders/:id/status', async (req, res) => {
    const { id: orderId } = parse(idParams, req.params);
    const body = parse(statusBody, req.body);
    res.json({
      data: await services.orders.updateStatusByStaff(
        currentApprovedStaff(req),
        orderId,
        body.status,
        body.reason,
      ),
    });
  });

  // Menu management
  router.get('/menu', async (req, res) => {
    res.json({ data: await services.menu.managedMenu(currentApprovedStaff(req).canteenId) });
  });
  router.post('/menu/categories', async (req, res) => {
    const body = parse(createCategoryBody, req.body);
    res.status(201).json({ data: await services.menu.createCategory(scope(req).canteenId, body) });
  });
  router.patch('/menu/categories/:id', async (req, res) => {
    const { id: categoryId } = parse(idParams, req.params);
    res.json({
      data: await services.menu.updateCategory(
        scope(req),
        categoryId,
        parse(updateCategoryBody, req.body),
      ),
    });
  });
  router.delete('/menu/categories/:id', async (req, res) => {
    const { id: categoryId } = parse(idParams, req.params);
    res.json({
      data: await services.menu.updateCategory(scope(req), categoryId, { isActive: false }),
    });
  });
  router.post('/menu/items', async (req, res) => {
    const body = parse(createItemBody, req.body);
    res.status(201).json({ data: await services.menu.createItem(scope(req).canteenId, body) });
  });
  router.patch('/menu/items/:id', async (req, res) => {
    const { id: itemId } = parse(idParams, req.params);
    res.json({
      data: await services.menu.updateItem(scope(req), itemId, parse(updateItemBody, req.body)),
    });
  });
  router.patch('/menu/items/:id/price', async (req, res) => {
    const { id: itemId } = parse(idParams, req.params);
    res.json({
      data: await services.menu.updateItem(scope(req), itemId, parse(priceBody, req.body)),
    });
  });
  router.patch('/menu/items/:id/availability', async (req, res) => {
    const { id: itemId } = parse(idParams, req.params);
    res.json({
      data: await services.menu.updateItem(scope(req), itemId, parse(availabilityBody, req.body)),
    });
  });
  router.delete('/menu/items/:id', async (req, res) => {
    const { id: itemId } = parse(idParams, req.params);
    res.json({ data: await services.menu.updateItem(scope(req), itemId, { isActive: false }) });
  });

  return router;
}
