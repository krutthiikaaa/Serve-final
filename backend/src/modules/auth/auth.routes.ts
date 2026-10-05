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

/**
 * /api/auth — registration and identity. Registration endpoints accept a
 * verified Firebase token from a user who has no SERVE account yet.
 */
export function createAuthRouter(ctx: AppContext, services: Services): Router {
  const router = Router();
  const service = services.auth;
  const authenticate = createAuthenticate(ctx);
  const limiter = sensitiveLimiter(ctx.env);

  router.use(authenticate);

  router.get('/me', async (req, res) => {
    const auth = req.auth!;
    res.json({ data: await service.me(auth, auth.principal) });
  });

  router.post('/student/register', limiter, async (req, res) => {
    const auth = req.auth!;
    await service.registerStudent(auth, parse(studentRegistrationBody, req.body));
    res
      .status(201)
      .json({ data: await service.me(auth, await resolvePrincipal(ctx.prisma, auth.uid)) });
  });

  router.post('/staff/register', limiter, async (req, res) => {
    const auth = req.auth!;
    await service.registerStaff(auth, parse(staffRegistrationBody, req.body));
    res
      .status(201)
      .json({ data: await service.me(auth, await resolvePrincipal(ctx.prisma, auth.uid)) });
  });

  return router;
}
