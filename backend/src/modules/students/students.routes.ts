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
    const target = canteenId ?? student.defaultCanteenId;
    res.json({
      data: target
        ? await services.recommendations.forStudent(student, target)
        : { basis: 'MENU', items: [] },
    });
  });
  /**
   * The student's service area with its Day and Night canteens, and the one
   * to show now (`current`: the canteen taking orders, else the default).
   * `current.availability.state` tells the app when neither can take orders.
   */
  router.get('/me/service', async (req, res) => {
    res.json({ data: await services.canteens.studentService(currentStudent(req)) });
  });
  return router;
}
