/**
 * Create demo accounts in the Firebase Auth EMULATOR and link them in
 * PostgreSQL. Development only — refuses to run against a real Firebase
 * project or outside NODE_ENV=development.
 *
 *   DEV_SEED_PASSWORD='choose-a-password' npm run db:seed:dev-users --workspace backend
 *
 * Requires the base seed (npm run db:seed) for canteens and hostels.
 * Idempotent: existing users/rows are reused.
 */
import type { Auth } from 'firebase-admin/auth';
import { loadEnv } from '../src/config/env.js';
import { closeFirebase, createFirebaseAuth } from '../src/lib/firebase.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { bootstrapAdmin } from '../src/modules/auth/admin-bootstrap.js';

const env = loadEnv();
if (env.NODE_ENV !== 'development' || !env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error(
    'seed-dev-users only runs with NODE_ENV=development and the Firebase Auth Emulator.',
  );
  process.exit(1);
}
const password = process.env.DEV_SEED_PASSWORD;
if (!password || password.length < 8) {
  console.error('Set DEV_SEED_PASSWORD (at least 8 characters) for the emulator demo accounts.');
  process.exit(1);
}

const auth = createFirebaseAuth(env);
const prisma = createPrismaClient(env.DATABASE_URL);

async function firebaseUid(authClient: Auth, email: string, displayName: string): Promise<string> {
  let uid: string;
  try {
    uid = (await authClient.getUserByEmail(email)).uid;
  } catch {
    uid = (await authClient.createUser({ email, password, displayName })).uid;
  }
  // The emulator keeps accounts in memory: after a restart the demo users get
  // new UIDs. Re-link existing demo rows (development only).
  await Promise.all([
    prisma.admin.updateMany({ where: { email }, data: { firebaseUid: uid } }),
    prisma.staff.updateMany({ where: { email }, data: { firebaseUid: uid } }),
    prisma.student.updateMany({ where: { email }, data: { firebaseUid: uid } }),
  ]);
  return uid;
}

try {
  const kg = await prisma.canteen.findUniqueOrThrow({ where: { slug: 'krishna-godavari' } });
  const yn = await prisma.canteen.findUniqueOrThrow({ where: { slug: 'yamuna-narmada' } });
  const krishna = await prisma.hostel.findUniqueOrThrow({ where: { name: 'Krishna' } });

  await firebaseUid(auth, 'admin@serve.dev', 'Dev Admin');
  await bootstrapAdmin(
    { auth, prisma },
    { email: 'admin@serve.dev', name: 'Dev Admin', password, allowCreateFirebaseUser: true },
  );

  const approvedUid = await firebaseUid(auth, 'staff.kg@serve.dev', 'Dev Staff (K&G)');
  await prisma.staff.upsert({
    where: { firebaseUid: approvedUid },
    update: {},
    create: {
      firebaseUid: approvedUid,
      email: 'staff.kg@serve.dev',
      name: 'Dev Staff (K&G)',
      status: 'APPROVED',
      canteenId: kg.id,
    },
  });

  const pendingUid = await firebaseUid(auth, 'staff.pending@serve.dev', 'Dev Staff (pending)');
  const pending = await prisma.staff.upsert({
    where: { firebaseUid: pendingUid },
    update: {},
    create: {
      firebaseUid: pendingUid,
      email: 'staff.pending@serve.dev',
      name: 'Dev Staff (pending)',
    },
  });
  const hasRequest = await prisma.canteenChangeRequest.count({ where: { staffId: pending.id } });
  if (hasRequest === 0) {
    await prisma.canteenChangeRequest.create({
      data: { staffId: pending.id, requestedCanteenId: yn.id, notes: 'Demo access request' },
    });
  }

  const studentUid = await firebaseUid(auth, 'student@serve.dev', 'Dev Student');
  await prisma.student.upsert({
    where: { firebaseUid: studentUid },
    update: {},
    create: {
      firebaseUid: studentUid,
      email: 'student@serve.dev',
      name: 'Dev Student',
      hostelId: krishna.id,
    },
  });

  console.error(
    'Emulator demo accounts ready: admin@serve.dev, staff.kg@serve.dev (approved, K&G), ' +
      'staff.pending@serve.dev (pending), student@serve.dev (Krishna). Password: $DEV_SEED_PASSWORD',
  );
} finally {
  await prisma.$disconnect();
  await closeFirebase();
}
