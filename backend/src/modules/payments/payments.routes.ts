import express, { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Services } from '../../services.js';
import { createAuthenticate, currentStudent, requireStudent } from '../../middleware/auth.js';
import { sensitiveLimiter } from '../../middleware/rate-limit.js';
import { id, parse } from '../../http/validation.js';

const orderParams = z.object({ orderId: id });
const confirmationBody = z.object({
  providerOrderId: z.string().min(1).max(100),
  providerPaymentId: z.string().min(1).max(100),
  signature: z.string().min(1).max(256),
});
const mockCompleteBody = z.object({
  outcome: z.enum(['success', 'failure']).default('success'),
  /** Simulates the gateway capturing a different amount (tests amount verification). */
  capturedAmountPaise: z.number().int().positive().optional(),
});

/**
 * Raw-body webhook router — mounted BEFORE express.json so the signature is
 * verified over the exact bytes the provider sent.
 */
export function createPaymentWebhookRouter(ctx: AppContext, services: Services): Router {
  const router = Router();
  router.post(
    '/razorpay',
    sensitiveLimiter(ctx.env),
    express.raw({ type: 'application/json', limit: '256kb' }),
    async (req, res) => {
      if (ctx.payments.name !== 'RAZORPAY') {
        res.status(404).json({ error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'Not found' } });
        return;
      }
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const result = await services.payments.handleWebhook(
        body,
        req.header('X-Razorpay-Signature'),
        req.header('X-Razorpay-Event-Id'),
      );
      res.json({ data: result });
    },
  );
  return router;
}

/** /api/payments — student payment flow. */
export function createPaymentsRouter(ctx: AppContext, services: Services): Router {
  const router = Router();
  const limiter = sensitiveLimiter(ctx.env);
  router.use(createAuthenticate(ctx), requireStudent);

  router.post('/:orderId/initiate', limiter, async (req, res) => {
    const { orderId } = parse(orderParams, req.params);
    res.json({ data: await services.payments.initiate(currentStudent(req), orderId) });
  });

  router.post('/:orderId/verify', limiter, async (req, res) => {
    const { orderId } = parse(orderParams, req.params);
    const result = await services.payments.confirm(
      currentStudent(req),
      orderId,
      parse(confirmationBody, req.body),
    );
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.json({ data: result.order });
  });

  // Development/test only. Never mounted in production or outside mock mode.
  if (ctx.env.PAYMENT_MODE === 'mock' && ctx.env.NODE_ENV !== 'production') {
    router.post('/:orderId/mock-complete', limiter, async (req, res) => {
      const { orderId } = parse(orderParams, req.params);
      const result = await services.payments.mockComplete(
        currentStudent(req),
        orderId,
        parse(mockCompleteBody, req.body ?? {}),
      );
      if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
      res.json({ data: { order: result.order, confirmation: result.confirmation } });
    });
  }

  return router;
}
