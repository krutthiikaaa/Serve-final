/**
 * Pre-provision development accounts. Development only (NODE_ENV=development);
 * unset addresses are skipped.
 *
 *   DEV_ADMIN_EMAIL=a@srmap.edu.in \
 *   DEV_STAFF_NIGHT_EMAIL=b@example.com DEV_STAFF_DAY_EMAIL=c@example.com \
 *   DEV_STAFF_PENDING_EMAIL=d@example.com DEV_STUDENT_EMAIL=e@srmap.edu.in \
 *   npm run db:seed:dev-users --workspace backend
 *
 * The student signs in with that Google account (@srmap.edu.in). Staff (any
 * address) and the admin (@srmap.edu.in) sign in with email + password: the
 * password is asked for once (hidden, or the first line of stdin) and set on
 * every staff/admin account provisioned here.
 *
 * Requires the base seed (npm run db:seed) for canteens and hostels.
 * Idempotent: existing rows are reused; nothing is deleted.
 */
import { loadEnv } from '../src/config/env.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { bootstrapAdmin } from '../src/modules/auth/admin-bootstrap.js';
import { isSrmEmail, normalizeEmail } from '../src/modules/auth/srm-email.js';
import { isPasswordIdentityEmail } from '../src/modules/auth/sign-in-method.js';
import { hashNewPassword, setAccountPassword } from '../src/modules/auth/password-accounts.js';
import { readNewPassword } from './read-password.js';

const env = loadEnv();
if (env.NODE_ENV !== 'development') {
  console.error('seed-dev-users only runs with NODE_ENV=development.');
  process.exit(1);
}

function emailFrom(variable: string, srmOnly = true): string | null {
  const raw = process.env[variable];
  if (!raw) return null;
  const email = normalizeEmail(raw);
  if (!email || (srmOnly ? !isSrmEmail(email) : !isPasswordIdentityEmail(email))) {
    console.error(`${variable} must be ${srmOnly ? 'an @srmap.edu.in' : 'a valid email'} address.`);
    process.exit(1);
  }
  return email;
}

const adminEmail = emailFrom('DEV_ADMIN_EMAIL');
const nightEmail = emailFrom('DEV_STAFF_NIGHT_EMAIL', false);
const dayEmail = emailFrom('DEV_STAFF_DAY_EMAIL', false);
const pendingEmail = emailFrom('DEV_STAFF_PENDING_EMAIL', false);
const studentEmail = emailFrom('DEV_STUDENT_EMAIL');
if (![adminEmail, nightEmail, dayEmail, pendingEmail, studentEmail].some(Boolean)) {
  console.error(
    'Set at least one DEV_*_EMAIL variable (see the comment at the top of this script).',
  );
  process.exit(1);
}

const passwordAccounts: { role: 'STAFF' | 'ADMIN'; email: string }[] = [
  ...(adminEmail ? [{ role: 'ADMIN' as const, email: adminEmail }] : []),
  ...[nightEmail, dayEmail, pendingEmail]
    .filter((email): email is string => Boolean(email))
    .map((email) => ({ role: 'STAFF' as const, email })),
];
const passwordHash =
  passwordAccounts.length > 0
    ? await hashNewPassword(await readNewPassword('Password for the dev staff/admin accounts'))
    : null;

const prisma = createPrismaClient(env.DATABASE_URL);
const ready: string[] = [];

try {
  const kg = await prisma.canteen.findUniqueOrThrow({ where: { slug: 'krishna-godavari' } });
  const kgDay = await prisma.canteen.findUniqueOrThrow({ where: { slug: 'krishna-godavari-day' } });
  const yn = await prisma.canteen.findUniqueOrThrow({ where: { slug: 'yamuna-narmada' } });
  const krishna = await prisma.hostel.findUniqueOrThrow({ where: { name: 'Krishna' } });

  if (adminEmail) {
    await bootstrapAdmin({ prisma }, { email: adminEmail, name: 'Dev Admin' });
    ready.push(`${adminEmail} (admin)`);
  }

  // One dedicated account per canteen (Day and Night are separate canteens).
  async function dedicatedStaff(email: string, name: string, canteenId: string) {
    const staff = await prisma.staff.upsert({
      where: { email },
      update: {},
      create: { email, name, status: 'APPROVED', canteenId },
    });
    const assignment = await prisma.staffCanteenAssignment.upsert({
      where: { staffId_canteenId: { staffId: staff.id, canteenId } },
      update: {},
      create: { staffId: staff.id, canteenId },
    });
    for (const capability of ['KITCHEN', 'MENU', 'PAUSE', 'CASHIER'] as const) {
      await prisma.staffAssignmentCapability.upsert({
        where: { assignmentId_capability: { assignmentId: assignment.id, capability } },
        update: {},
        create: { assignmentId: assignment.id, capability },
      });
    }
  }
  if (nightEmail) {
    await dedicatedStaff(nightEmail, 'K&G Night Canteen', kg.id);
    ready.push(`${nightEmail} (K&G Night staff)`);
  }
  if (dayEmail) {
    await dedicatedStaff(dayEmail, 'K&G Day Canteen', kgDay.id);
    ready.push(`${dayEmail} (K&G Day staff)`);
  }

  if (pendingEmail) {
    const pending = await prisma.staff.upsert({
      where: { email: pendingEmail },
      update: {},
      create: { email: pendingEmail, name: 'Dev Staff (pending)' },
    });
    const hasRequest = await prisma.canteenChangeRequest.count({ where: { staffId: pending.id } });
    if (hasRequest === 0) {
      await prisma.canteenChangeRequest.create({
        data: { staffId: pending.id, requestedCanteenId: yn.id, notes: 'Demo access request' },
      });
    }
    ready.push(`${pendingEmail} (pending staff)`);
  }

  if (studentEmail) {
    await prisma.student.upsert({
      where: { email: studentEmail },
      update: {},
      create: { email: studentEmail, name: 'Dev Student', hostelId: krishna.id },
    });
    ready.push(`${studentEmail} (student, Krishna)`);
  }

  if (passwordHash) {
    for (const account of passwordAccounts) {
      await setAccountPassword(prisma, { ...account, passwordHash });
    }
  }
  console.error(
    `Development accounts ready (student: Google sign-in; staff/admin: email + password): ${ready.join(', ')}`,
  );
} finally {
  await prisma.$disconnect();
}
