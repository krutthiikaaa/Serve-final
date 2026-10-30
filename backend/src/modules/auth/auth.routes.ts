import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { createAuthenticate } from '../../middleware/auth.js';
import { sensitiveLimiter } from '../../middleware/rate-limit.js';
import { email, id, name, parse } from '../../http/validation.js';
import type { Services } from '../../services.js';
import { resolvePrincipal } from './principal.js';

const studentRegistrationBody = z.strictObject({ name, email, hostelId: id });
const staffRegistrationBody = z.strictObject({ name, email, requestedCanteenId: id.optional() });
const ssoAudience = z.enum(['STAFF', 'ADMIN']);
const ssoInitiateBody = z.strictObject({ audience: ssoAudience });
const ssoExchangeBody = z.strictObject({
  code: z.string().trim().min(16).max(128),
  audience: ssoAudience,
});

/**
 * /api/auth — registration, identity and dashboard SSO handoff.
 * Registration and SSO initiate accept a verified Firebase token.
 * SSO exchange is public: it consumes a one-time authorization code.
 */
export function createAuthRouter(ctx: AppContext, services: Services): Router {
  const router = Router();
  const service = services.auth;
  const sso = services.sso;
  const authenticate = createAuthenticate(ctx);
  const limiter = sensitiveLimiter(ctx.env);

  router.get('/me', authenticate, async (req, res) => {
    const auth = req.auth!;
    res.json({ data: await service.me(auth, auth.principal) });
  });

  router.post('/student/register', authenticate, limiter, async (req, res) => {
    const auth = req.auth!;
    await service.registerStudent(auth, parse(studentRegistrationBody, req.body));
    res
      .status(201)
      .json({ data: await service.me(auth, await resolvePrincipal(ctx.prisma, auth.uid)) });
  });

  router.post('/staff/register', authenticate, limiter, async (req, res) => {
    const auth = req.auth!;
    await service.registerStaff(auth, parse(staffRegistrationBody, req.body));
    res
      .status(201)
      .json({ data: await service.me(auth, await resolvePrincipal(ctx.prisma, auth.uid)) });
  });

  router.post('/sso/initiate', authenticate, limiter, async (req, res) => {
    const auth = req.auth!;
    const { audience } = parse(ssoInitiateBody, req.body);
    res.json({ data: await sso.initiate(auth.uid, auth.principal, audience) });
  });

  router.post('/sso/exchange', limiter, async (req, res) => {
    const { code, audience } = parse(ssoExchangeBody, req.body);
    res.json({ data: await sso.exchange(code, audience) });
  });

  return router;
}
