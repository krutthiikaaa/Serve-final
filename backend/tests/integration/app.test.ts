import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/test-app.js';

const ALLOWED = 'http://localhost:5173';
const BLOCKED = 'https://evil.example.com';

describe('security middleware', () => {
  const { app, prisma, env } = buildTestApp();
  afterAll(() => prisma.$disconnect());

  it('test environment allows the expected origin', () => {
    expect(env.CORS_ORIGINS).toContain(ALLOWED);
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('CORS: allows configured origins', async () => {
    const res = await request(app).get('/api/health').set('Origin', ALLOWED).expect(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
  });

  it('CORS: does not grant unknown origins', async () => {
    const res = await request(app).get('/api/health').set('Origin', BLOCKED);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('CORS: answers preflight for allowed origins with the API headers', async () => {
    const res = await request(app)
      .options('/api/orders')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type,idempotency-key')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-headers']).toMatch(/Authorization/);
    expect(res.headers['access-control-allow-headers']).toMatch(/Idempotency-Key/);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('CORS: preflight from unknown origins is not granted', async () => {
    const res = await request(app)
      .options('/api/orders')
      .set('Origin', BLOCKED)
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('request ids and error handling', () => {
  const { app, prisma } = buildTestApp();
  afterAll(() => prisma.$disconnect());

  it('generates an X-Request-Id for every response', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses a well-formed incoming X-Request-Id and replaces a malformed one', async () => {
    const good = await request(app).get('/api/health').set('X-Request-Id', 'lb-trace-12345678');
    expect(good.headers['x-request-id']).toBe('lb-trace-12345678');

    const bad = await request(app)
      .get('/api/health')
      .set('X-Request-Id', '<script>alert(1)</script>');
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns a JSON 404 for unknown routes, including the request id', async () => {
    const res = await request(app).get('/api/does-not-exist').expect(404);
    expect(res.body.error).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('returns 400 INVALID_JSON for malformed JSON bodies', async () => {
    const res = await request(app)
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 413 PAYLOAD_TOO_LARGE for oversized bodies', async () => {
    const res = await request(app)
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(200 * 1024) }))
      .expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('rate limiting', () => {
  const { app, prisma } = buildTestApp({ RATE_LIMIT_MAX: '2', RATE_LIMIT_WINDOW_MS: '60000' });
  afterAll(() => prisma.$disconnect());

  it('limits API requests per client and returns 429 RATE_LIMITED', async () => {
    await request(app).get('/api/x').expect(404);
    await request(app).get('/api/x').expect(404);
    const res = await request(app).get('/api/x').expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });

  it('never rate-limits health probes', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(app).get('/api/health').expect(200);
    }
  });
});
