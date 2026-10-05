import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { Env } from '../config/env.js';

/**
 * Stricter limiter for sensitive operations (registration, order creation,
 * payments, webhooks). Mount AFTER authentication so the limit applies per
 * Firebase user; anonymous callers are limited per IP.
 */
export function sensitiveLimiter(
  env: Pick<Env, 'SENSITIVE_RATE_LIMIT_WINDOW_MS' | 'SENSITIVE_RATE_LIMIT_MAX'>,
) {
  return rateLimit({
    windowMs: env.SENSITIVE_RATE_LIMIT_WINDOW_MS,
    limit: env.SENSITIVE_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) =>
      req.auth ? `uid:${req.auth.uid}` : `ip:${ipKeyGenerator(req.ip ?? '')}`,
    handler(_req, res, _next, options) {
      res.status(options.statusCode).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
      });
    },
  });
}
