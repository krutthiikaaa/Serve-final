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
import {
  requireAnyStaffCapability,
  requireStaffCapability,
  resolveStaffCanteen,
  staffOperatingCanteenId,
} from '../../middleware/staff-capability.js';
import { id, idParams, optionalText, paginationQuery, parse } from '../../http/validation.js';
import { STAFF_SETTABLE_STATUSES } from '../orders/order-state.js';
import { quantity } from '../../http/validation.js';
import {
  availabilityBody,
  createCategoryBody,
  createItemBody,
  priceBody,
  updateCategoryBody,
  updateItemBody,
} from '../menu/menu.schemas.js';
import { systemClock } from '../../lib/time.js';

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
const confirmPaymentBody = z.strictObject({
  paymentReceived: z.literal(true),
  utr: optionalText(64),
});
const confirmDemoPaymentBody = z.strictObject({
  simulatedPaymentReceived: z.literal(true),
  utr: optionalText(64),
});
const rejectPaymentBody = z.strictObject({ reason: optionalText(200) });
const walkInBody = z.strictObject({
  servicePeriod: z.enum(['DAY', 'NIGHT']),
  paymentMethod: z.enum(['CASH', 'UPI']),
  paymentReceived: z.literal(true),
  guestName: optionalText(80),
  utr: optionalText(64),
  items: z
    .array(z.strictObject({ menuItemId: id, quantity }))
    .min(1, { error: 'Add at least one item' }),
});
const walkInDemoBody = z.strictObject({
  servicePeriod: z.enum(['DAY', 'NIGHT']),
  paymentMethod: z.enum(['CASH', 'UPI']),
  simulatedPaymentReceived: z.literal(true),
  guestName: optionalText(80),
  utr: optionalText(64),
  items: z
    .array(z.strictObject({ menuItemId: id, quantity }))
    .min(1, { error: 'Add at least one item' }),
});
const salesQuery = paginationQuery.extend({
  channel: z.enum(['APP', 'WALK_IN']).optional(),
  method: z.enum(['CASH', 'UPI']).optional(),
  period: z.enum(['DAY', 'NIGHT']).optional(),
  simulated: z.enum(['true', 'false']).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
const posMenuQuery = z.object({ period: z.enum(['DAY', 'NIGHT']).optional() });

/**
 * /api/staff — canteen operations. Operating canteen is the primary
 * Staff.canteenId unless `?canteenId=` is present AND assigned in PostgreSQL.
 */
export function createStaffRouter(ctx: AppContext, services: Services): Router {
  const router = Router();
  router.use(createAuthenticate(ctx), requireStaff);

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

  router.use(requireApprovedStaff, resolveStaffCanteen(ctx.prisma));
  const kitchen = requireStaffCapability(ctx.prisma, 'KITCHEN');
  const menu = requireStaffCapability(ctx.prisma, 'MENU');
  const pause = requireStaffCapability(ctx.prisma, 'PAUSE');
  const cashier = requireStaffCapability(ctx.prisma, 'CASHIER');
  const receiptAccess = requireAnyStaffCapability(ctx.prisma, ['CASHIER', 'KITCHEN']);
  const scope = (req: Parameters<typeof currentApprovedStaff>[0]) => ({
    canteenId: staffOperatingCanteenId(req),
  });

  router.get('/dashboard', async (req, res) => {
    res.json({
      data: await services.staff.dashboard(
        currentApprovedStaff(req),
        staffOperatingCanteenId(req),
      ),
    });
  });
  router.patch('/canteen/status', pause, async (req, res) => {
    const { isAcceptingOrders } = parse(
      z.strictObject({ isAcceptingOrders: z.boolean() }),
      req.body,
    );
    res.json({
      data: await services.staff.setAcceptingOrders(
        currentApprovedStaff(req),
        staffOperatingCanteenId(req),
        isAcceptingOrders,
      ),
    });
  });

  router.get('/orders', kitchen, async (req, res) => {
    const query = parse(orderListQuery, req.query);
    res.json(
      await services.orders.listForCanteen(staffOperatingCanteenId(req), query.status, query),
    );
  });
  router.get('/orders/:id', kitchen, async (req, res) => {
    const { id: orderId } = parse(idParams, req.params);
    res.json({
      data: await services.orders.getForCanteen(staffOperatingCanteenId(req), orderId),
    });
  });
  router.patch('/orders/:id/status', kitchen, async (req, res) => {
    const { id: orderId } = parse(idParams, req.params);
    const body = parse(statusBody, req.body);
    res.json({
      data: await services.orders.updateStatusByStaff(
        currentApprovedStaff(req),
        staffOperatingCanteenId(req),
        orderId,
        body.status,
        body.reason,
      ),
    });
  });

  router.get('/menu', menu, async (req, res) => {
    res.json({ data: await services.menu.managedMenu(staffOperatingCanteenId(req)) });
  });
  router.post('/menu/categories', menu, async (req, res) => {
    const body = parse(createCategoryBody, req.body);
    res.status(201).json({ data: await services.menu.createCategory(scope(req).canteenId, body) });
  });
  router.patch('/menu/categories/:id', menu, async (req, res) => {
    const { id: categoryId } = parse(idParams, req.params);
    res.json({
      data: await services.menu.updateCategory(
        scope(req),
        categoryId,
        parse(updateCategoryBody, req.body),
      ),
    });
  });
  router.delete('/menu/categories/:id', menu, async (req, res) => {
    const { id: categoryId } = parse(idParams, req.params);
    res.json({
      data: await services.menu.updateCategory(scope(req), categoryId, { isActive: false }),
    });
  });
  router.post('/menu/items', menu, async (req, res) => {
    const body = parse(createItemBody, req.body);
    res.status(201).json({ data: await services.menu.createItem(scope(req).canteenId, body) });
  });
  router.patch('/menu/items/:id', menu, async (req, res) => {
    const { id: itemId } = parse(idParams, req.params);
    res.json({
      data: await services.menu.updateItem(scope(req), itemId, parse(updateItemBody, req.body)),
    });
  });
  router.patch('/menu/items/:id/price', menu, async (req, res) => {
    const { id: itemId } = parse(idParams, req.params);
    res.json({
      data: await services.menu.updateItem(scope(req), itemId, parse(priceBody, req.body)),
    });
  });
  router.patch('/menu/items/:id/availability', menu, async (req, res) => {
    const { id: itemId } = parse(idParams, req.params);
    res.json({
      data: await services.menu.updateItem(scope(req), itemId, parse(availabilityBody, req.body)),
    });
  });
  router.delete('/menu/items/:id', menu, async (req, res) => {
    const { id: itemId } = parse(idParams, req.params);
    res.json({ data: await services.menu.updateItem(scope(req), itemId, { isActive: false }) });
  });

  router.get('/payments/pending', cashier, async (req, res) => {
    res.json(
      await services.cashier.pendingPayments(
        staffOperatingCanteenId(req),
        parse(paginationQuery, req.query),
      ),
    );
  });
  router.post('/orders/:id/confirm-payment', cashier, async (req, res) => {
    const { id: orderId } = parse(idParams, req.params);
    const body = parse(confirmPaymentBody, req.body);
    res.json({
      data: await services.cashier.confirmPayment(
        currentApprovedStaff(req),
        staffOperatingCanteenId(req),
        orderId,
        { paymentReceived: body.paymentReceived, utr: body.utr },
      ),
    });
  });
  router.post('/orders/:id/confirm-demo-payment', cashier, async (req, res) => {
    const { id: orderId } = parse(idParams, req.params);
    const body = parse(confirmDemoPaymentBody, req.body);
    res.json({
      data: await services.cashier.confirmDemoPayment(
        currentApprovedStaff(req),
        staffOperatingCanteenId(req),
        orderId,
        { simulatedPaymentReceived: body.simulatedPaymentReceived, utr: body.utr },
      ),
    });
  });
  router.post('/orders/:id/reject-payment', cashier, async (req, res) => {
    const { id: orderId } = parse(idParams, req.params);
    const body = parse(rejectPaymentBody, req.body ?? {});
    res.json({
      data: await services.cashier.rejectPayment(
        currentApprovedStaff(req),
        staffOperatingCanteenId(req),
        orderId,
        body.reason,
      ),
    });
  });
  router.get('/pos/menu', cashier, async (req, res) => {
    const { period } = parse(posMenuQuery, req.query);
    res.json({
      data: await services.cashier.posMenu(
        currentApprovedStaff(req),
        staffOperatingCanteenId(req),
        period ?? 'NIGHT',
      ),
    });
  });
  router.get('/canteen/payment-config', cashier, async (req, res) => {
    res.json({ data: await services.cashier.paymentConfig(staffOperatingCanteenId(req)) });
  });
  router.post('/pos/sales', cashier, async (req, res) => {
    const body = parse(walkInBody, req.body);
    res.status(201).json({
      data: await services.cashier.completeWalkIn(
        currentApprovedStaff(req),
        staffOperatingCanteenId(req),
        body,
        systemClock(),
      ),
    });
  });
  router.post('/pos/demo-sales', cashier, async (req, res) => {
    const body = parse(walkInDemoBody, req.body);
    res.status(201).json({
      data: await services.cashier.completeDemoWalkIn(
        currentApprovedStaff(req),
        staffOperatingCanteenId(req),
        body,
        systemClock(),
      ),
    });
  });
  router.get('/sales', cashier, async (req, res) => {
    const query = parse(salesQuery, req.query);
    res.json(
      await services.cashier.listSales(
        staffOperatingCanteenId(req),
        {
          channel: query.channel,
          method: query.method,
          period: query.period,
          simulated: query.simulated === undefined ? undefined : query.simulated === 'true',
          from: query.from ? new Date(query.from) : undefined,
          to: query.to ? new Date(query.to) : undefined,
        },
        query,
      ),
    );
  });
  router.get('/orders/:id/receipt', receiptAccess, async (req, res) => {
    const { id: orderId } = parse(idParams, req.params);
    res.json({
      data: await services.cashier.receipt(staffOperatingCanteenId(req), orderId),
    });
  });

  return router;
}
