import { Router } from 'express';
import type { PrismaClient } from '../../lib/prisma.js';
import { ServiceUnavailableError } from '../../lib/errors.js';

export interface HealthDeps {
  prisma: PrismaClient;
  /** Max time to wait for the database before reporting it unavailable. */
  dbTimeoutMs?: number;
}

const startedAt = Date.now();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * GET /api/health     — process liveness (no dependencies).
 * GET /api/health/db  — PostgreSQL readiness via a real round-trip query.
 */
export function createHealthRouter({ prisma, dbTimeoutMs = 3_000 }: HealthDeps): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'serve-backend',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/db', async (req, res) => {
    const started = performance.now();
    try {
      const rows = await withTimeout(
        prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`,
        dbTimeoutMs,
      );
      if (rows[0]?.ok !== 1) throw new Error('Unexpected database health response');
    } catch (err) {
      req.log.warn({ err }, 'Database health check failed');
      throw new ServiceUnavailableError('Database is unreachable', 'DATABASE_UNAVAILABLE');
    }
    res.json({
      status: 'ok',
      database: 'postgresql',
      latencyMs: Math.round((performance.now() - started) * 100) / 100,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
