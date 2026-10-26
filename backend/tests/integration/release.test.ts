import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createFirebaseAuth } from '../../src/lib/firebase.js';
import { runRelease } from '../../src/ops/release.js';
import { createTestPrisma, truncateAll } from '../helpers/db.js';
import { createFirebaseUser, uniqueEmail } from '../helpers/firebase.js';
import { testEnv } from '../helpers/test-app.js';

/**
 * Production release tasks (scripts/start-production.sh) against the real test
 * database and the Firebase Auth Emulator.
 */
const env = testEnv();
const prisma = createTestPrisma();
const logger = pino({ level: 'silent' });
const auth = () => createFirebaseAuth(env);

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

describe('release tasks', () => {
  it('seeds the catalogue on an empty database, and only then', async () => {
    expect(await runRelease({ env, logger, prisma, auth })).toEqual({
      catalogue: 'seeded',
      admin: 'not-configured',
    });
    const canteens = await prisma.canteen.count();
    expect(canteens).toBeGreaterThan(0);

    expect((await runRelease({ env, logger, prisma, auth })).catalogue).toBe('present');
    expect(await prisma.canteen.count()).toBe(canteens);
  });

  it('never seeds a production database without DEMO_MODE', async () => {
    const production = { ...env, NODE_ENV: 'production' as const, DEMO_MODE: false };
    expect((await runRelease({ env: production, logger, prisma, auth })).catalogue).toBe('skipped');
    expect(await prisma.canteen.count()).toBe(0);
  });

  it('links an existing Firebase user as the first admin, idempotently', async () => {
    const user = await createFirebaseUser(uniqueEmail('ops'));
    const withAdmin = {
      ...env,
      ADMIN_BOOTSTRAP_EMAIL: user.email,
      ADMIN_BOOTSTRAP_NAME: 'Ops Admin',
    };
    expect((await runRelease({ env: withAdmin, logger, prisma, auth })).admin).toBe('linked');
    expect((await runRelease({ env: withAdmin, logger, prisma, auth })).admin).toBe('linked');

    const admins = await prisma.admin.findMany({ where: { email: user.email } });
    expect(admins).toHaveLength(1);
    expect(admins[0]?.firebaseUid).toBe(user.uid);
  });

  it('never creates a Firebase user, and a bad admin setting does not stop the release', async () => {
    const result = await runRelease({
      env: { ...env, ADMIN_BOOTSTRAP_EMAIL: uniqueEmail('nobody'), ADMIN_BOOTSTRAP_NAME: 'Nobody' },
      logger,
      prisma,
      auth,
    });
    expect(result).toEqual({ catalogue: 'seeded', admin: 'failed' });
    expect(await prisma.admin.count()).toBe(0);
  });

  it('refuses to link a student account as an admin', async () => {
    await runRelease({ env, logger, prisma, auth });
    const user = await createFirebaseUser(uniqueEmail('student'));
    const hostel = await prisma.hostel.findFirstOrThrow();
    await prisma.student.create({
      data: { firebaseUid: user.uid, email: user.email, name: 'A Student', hostelId: hostel.id },
    });
    const result = await runRelease({
      env: { ...env, ADMIN_BOOTSTRAP_EMAIL: user.email, ADMIN_BOOTSTRAP_NAME: 'Sneaky' },
      logger,
      prisma,
      auth,
    });
    expect(result.admin).toBe('failed');
    expect(await prisma.admin.count()).toBe(0);
  });
});
