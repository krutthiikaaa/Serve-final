import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Services } from '../../services.js';
import { createAuthenticate, currentStudent, requireStudent } from '../../middleware/auth.js';
import { id, parse } from '../../http/validation.js';

/** /api/students/me — student-specific helpers. */
export function createStudentsRouter(ctx: AppContext, services: Services): Router {
  const router = Router();
  router.use(createAuthenticate(ctx), requireStudent);
  router.get('/me/recommendations', async (req, res) => {
    const student = currentStudent(req);
    const { canteenId } = parse(z.object({ canteenId: id.optional() }), req.query);
    res.json({
      data: await services.recommendations.forStudent(
        student,
        canteenId ?? student.defaultCanteenId,
      ),
    });
  });
  return router;
}
