import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createPrismaClient } from '../../src/lib/prisma.js';
import { buildTestApp, buildTestContext } from '../helpers/test-app.js';

describe('health endpoints (real PostgreSQL)', () => {
  const { app, prisma } = buildTestApp();
  afterAll(() => prisma.$disconnect());

  it('GET /api/health reports the process is up', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'serve-backend' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  it('GET /api/health/db performs a real database round-trip', async () => {
    const res = await request(app).get('/api/health/db').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'postgresql' });
    expect(res.body.latencyMs).toBeGreaterThanOrEqual(0);

    // Independently confirm we are talking to the PostgreSQL test database.
    const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    expect(row?.db).toMatch(/test/);
  });
});

describe('health endpoints (PostgreSQL unreachable)', () => {
  // A real Prisma client pointed at a port where nothing is listening.
  const deadPrisma = createPrismaClient('postgresql://serve:invalid@127.0.0.1:1/serve_unreachable');
  const app = createApp(buildTestContext({ prisma: deadPrisma }));
  afterAll(() => deadPrisma.$disconnect());

  it('GET /api/health stays 200 (liveness has no DB dependency)', async () => {
    await request(app).get('/api/health').expect(200);
  });

  it('GET /api/health/db returns 503 DATABASE_UNAVAILABLE without leaking details', async () => {
    const res = await request(app).get('/api/health/db').expect(503);
    expect(res.body.error).toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database is unreachable',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/invalid|127\.0\.0\.1|ECONNREFUSED/);
  });
});
