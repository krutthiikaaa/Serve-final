import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { seedDatabase } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';
import { adminMenuCategorySchema } from '../helpers/contract.js';
import {
  bearer,
  canteenBySlug,
  newAdmin,
  newApprovedStaff,
  newStudent,
  type Actor,
} from '../helpers/actors.js';

const { app, prisma, env } = buildTestApp();

let admin: Actor;
let student: Actor;
let staff: Actor;
let kg: { id: string };
let inactiveItemId: string;
let nightOnlyItemId: string;
let dualPriceItemId: string;

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  kg = await canteenBySlug(prisma, 'krishna-godavari');
  admin = await newAdmin(prisma, env);
  student = await newStudent(app, prisma);
  staff = await newApprovedStaff(app, admin, kg.id);

  const category = await prisma.menuCategory.findFirstOrThrow({
    where: { canteenId: kg.id },
    orderBy: { sortOrder: 'asc' },
  });

  const inactive = await prisma.menuItem.create({
    data: {
      canteenId: kg.id,
      categoryId: category.id,
      name: 'Catalogue Inactive Roll',
      pricePaise: 5_000,
      isAvailable: false,
      isActive: false,
      services: {
        create: [
          { period: 'DAY', pricePaise: 3_000, isAvailable: false },
          { period: 'NIGHT', pricePaise: 4_500, isAvailable: true },
        ],
      },
    },
  });
  inactiveItemId = inactive.id;

  const nightOnly = await prisma.menuItem.create({
    data: {
      canteenId: kg.id,
      categoryId: category.id,
      name: 'Catalogue Night Only Wrap',
      pricePaise: 6_000,
      isAvailable: true,
      isActive: true,
      services: {
        create: [{ period: 'NIGHT', pricePaise: 6_000, isAvailable: true }],
      },
    },
  });
  nightOnlyItemId = nightOnly.id;

  const dual = await prisma.menuItem.create({
    data: {
      canteenId: kg.id,
      categoryId: category.id,
      name: 'Catalogue Dual Price Toast',
      pricePaise: 8_000,
      isAvailable: true,
      isActive: true,
      services: {
        create: [
          { period: 'DAY', pricePaise: 7_000, isAvailable: true },
          { period: 'NIGHT', pricePaise: 8_500, isAvailable: true },
        ],
      },
    },
  });
  dualPriceItemId = dual.id;
});
afterAll(() => prisma.$disconnect());

function cataloguePath(canteenId = kg.id) {
  return `/api/admin/canteens/${canteenId}/menu/catalogue`;
}

type CatalogueItem = {
  id: string;
  name: string;
  isActive: boolean;
  isAvailable: boolean;
  services: { period: string; pricePaise: number; isAvailable: boolean }[];
};

function flattenItems(body: { data: { items: CatalogueItem[] }[] }) {
  return body.data.flatMap((category) => category.items);
}

describe('admin menu catalogue', () => {
  it('returns inactive items with stored DAY and NIGHT prices and period availability', async () => {
    const res = await request(app).get(cataloguePath()).set(bearer(admin.token)).expect(200);
    z.array(adminMenuCategorySchema).parse(res.body.data);

    const inactive = flattenItems(res.body).find((item) => item.id === inactiveItemId);
    expect(inactive).toMatchObject({
      name: 'Catalogue Inactive Roll',
      isActive: false,
      isAvailable: false,
    });
    expect(inactive?.services).toEqual([
      { period: 'DAY', pricePaise: 3_000, isAvailable: false },
      { period: 'NIGHT', pricePaise: 4_500, isAvailable: true },
    ]);
  });

  it('omits missing period prices instead of inventing them', async () => {
    const res = await request(app).get(cataloguePath()).set(bearer(admin.token)).expect(200);
    const nightOnly = flattenItems(res.body).find((item) => item.id === nightOnlyItemId);
    expect(nightOnly?.services).toEqual([
      { period: 'NIGHT', pricePaise: 6_000, isAvailable: true },
    ]);
    expect(nightOnly?.services.some((service) => service.period === 'DAY')).toBe(false);
  });

  it('returns different DAY and NIGHT prices for the same item', async () => {
    const res = await request(app).get(cataloguePath()).set(bearer(admin.token)).expect(200);
    const dual = flattenItems(res.body).find((item) => item.id === dualPriceItemId);
    expect(dual?.services).toEqual([
      { period: 'DAY', pricePaise: 7_000, isAvailable: true },
      { period: 'NIGHT', pricePaise: 8_500, isAvailable: true },
    ]);
  });

  it('rejects students and staff', async () => {
    for (const actor of [student, staff]) {
      const res = await request(app).get(cataloguePath()).set(bearer(actor.token)).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
    }
  });

  it('requires authentication', async () => {
    const res = await request(app).get(cataloguePath()).expect(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });
});
