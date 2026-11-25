import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { createAuthenticate } from '../../middleware/auth.js';
import { sensitiveLimiter } from '../../middleware/rate-limit.js';
import { email, id, name, parse } from '../../http/validation.js';
import type { Services } from '../../services.js';
import { resolvePrincipal } from './principal.js';
import { hashNewPassword } from './password-accounts.js';
import { passwordSchema } from './sign-in-method.js';

// The email always comes from the signed-in Google identity; a body may only
// repeat it (older clients send it), never choose it.
const studentRegistrationBody = z.strictObject({ name, email: email.optional(), hostelId: id });
// Staff self-registration: email + password. Any address (e.g. Gmail); it is
// not verified. The account is always PENDING until an admin approves it.
const staffSignUpBody = z.strictObject({
  name,
  email: email.pipe(z.string().max(254)),
  password: passwordSchema,
  requestedCanteenId: id.optional(),
});

/**
 * /api/auth — SERVE account endpoints next to Better Auth's own routes
 * (sign-in/social, sign-in/email, callback/google, get-session, sign-out …,
 * see app.ts).
 *   GET  /me                 any signed-in identity (method checked per role)
 *   POST /student/register   Google session only (students)
 *   POST /staff/sign-up      no session: creates a PENDING staff account with
 *                            a password; the client then signs in with it
 */
export const SERVE_AUTH_PATHS = new Set(['/me', '/student/register', '/staff/sign-up']);

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

  router.post('/staff/sign-up', limiter, async (req, res) => {
    const body = parse(staffSignUpBody, req.body);
    const passwordHash = await hashNewPassword(body.password);
    await service.signUpStaff({
      name: body.name,
      email: body.email,
      passwordHash,
      requestedCanteenId: body.requestedCanteenId,
    });
    res.status(201).json({ data: { email: body.email, status: 'PENDING' as const } });
  });

  return router;
}
