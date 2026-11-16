import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { createAuthenticate } from '../../middleware/auth.js';
import { sensitiveLimiter } from '../../middleware/rate-limit.js';
import { email, id, name, parse } from '../../http/validation.js';
import type { Services } from '../../services.js';
import { resolvePrincipal } from './principal.js';

// The email always comes from the signed-in Google identity; a body may only
// repeat it (older clients send it), never choose it.
const studentRegistrationBody = z.strictObject({ name, email: email.optional(), hostelId: id });
const staffRegistrationBody = z.strictObject({
  name,
  email: email.optional(),
  requestedCanteenId: id.optional(),
});

/**
 * /api/auth — SERVE account endpoints next to Better Auth's own routes
 * (sign-in/social, callback/google, get-session, sign-out …, see app.ts).
 * All of them need a signed-in @srmap.edu.in identity.
 */
export const SERVE_AUTH_PATHS = new Set(['/me', '/student/register', '/staff/register']);

export function createAuthRouter(ctx: AppContext, services: Services): Router {
  const router = Router();
  const service = services.auth;
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
      .json({ data: await service.me(auth, await resolvePrincipal(ctx.prisma, auth)) });
  });

  router.post('/staff/register', authenticate, limiter, async (req, res) => {
    const auth = req.auth!;
    await service.registerStaff(auth, parse(staffRegistrationBody, req.body));
    res
      .status(201)
      .json({ data: await service.me(auth, await resolvePrincipal(ctx.prisma, auth)) });
  });

  return router;
}
