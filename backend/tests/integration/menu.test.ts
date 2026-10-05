import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';
import {
  bearer,
  canteenBySlug,
  itemByName,
  newAdmin,
  newApprovedStaff,
  newPendingStaff,
  newStudent,
  type Actor,
} from '../helpers/actors.js';

const { app, prisma, env } = buildTestApp();

let admin: Actor;
let student: Actor;
let staffKG: Actor; // Krishna & Godavari
let staffYN: Actor; // Yamuna & Narmada
let kg: { id: string };
let yn: { id: string };

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  kg = await canteenBySlug(prisma, 'krishna-godavari');
  yn = await canteenBySlug(prisma, 'yamuna-narmada');
  admin = await newAdmin(prisma, env);
  student = await newStudent(app, prisma);
  staffKG = await newApprovedStaff(app, admin, kg.id);
  staffYN = await newApprovedStaff(app, admin, yn.id);
});
afterAll(() => prisma.$disconnect());

describe('hostels and canteens', () => {
  it('lists hostels publicly with their default canteen', async () => {
    const res = await request(app).get('/api/hostels').expect(200);
    expect(res.body.data).toHaveLength(8);
    expect(res.body.data.find((h: { name: string }) => h.name === 'Ganga B').canteen.name).toBe(
      'Ganga A & Ganga B Night Canteen',
    );
  });

  it('requires authentication to browse canteens', async () => {
    await request(app).get('/api/canteens').expect(401);
  });

  it('shows students only active canteens; admins see all', async () => {
    const hidden = await prisma.canteen.create({
      data: { name: 'Closed Canteen', slug: 'closed-canteen', isActive: false },
    });
    const forStudent = await request(app)
      .get('/api/canteens')
      .set(bearer(student.token))
      .expect(200);
    expect(forStudent.body.data.map((c: { id: string }) => c.id)).not.toContain(hidden.id);
    expect(forStudent.body.data).toHaveLength(5);
    expect(forStudent.body.data[0]).toMatchObject({ status: 'ACCEPTING_ORDERS', isActive: true });

    const forAdmin = await request(app).get('/api/canteens').set(bearer(admin.token)).expect(200);
    expect(forAdmin.body.data.map((c: { id: string }) => c.id)).toContain(hidden.id);

    await request(app).get(`/api/canteens/${hidden.id}`).set(bearer(student.token)).expect(404);
    await request(app).get(`/api/canteens/${hidden.id}`).set(bearer(admin.token)).expect(200);
    await request(app).get('/api/canteens/not-a-uuid').set(bearer(student.token)).expect(422);
  });
});

describe('student menu', () => {
  it('returns the canteen menu grouped by category with prices in paise', async () => {
    const res = await request(app)
      .get(`/api/canteens/${kg.id}/menu`)
      .set(bearer(student.token))
      .expect(200);
    expect(res.body.data.canteen).toMatchObject({ id: kg.id, status: 'ACCEPTING_ORDERS' });
    const names = res.body.data.categories.map((c: { name: string }) => c.name);
    expect(names).toEqual([
      'Sandwiches',
      'Desi Bite Bites',
      'Omelettes',
      'Juices',
      'Dosas',
      'Hot Beverages',
    ]);
    const coffee = res.body.data.categories
      .flatMap((c: { items: unknown[] }) => c.items)
      .find((i: { name: string }) => i.name === 'Coffee');
    expect(coffee).toMatchObject({ pricePaise: 3_000, isAvailable: true, isOrderable: true });
  });

  it('returns an empty menu (not fallback data) for a canteen with no items', async () => {
    const empty = await prisma.canteen.create({
      data: { name: 'Empty Canteen', slug: 'empty-canteen' },
    });
    const res = await request(app)
      .get(`/api/canteens/${empty.id}/menu`)
      .set(bearer(student.token))
      .expect(200);
    expect(res.body.data.categories).toEqual([]);
  });

  it('lists categories and item details', async () => {
    const cats = await request(app)
      .get(`/api/canteens/${kg.id}/categories`)
      .set(bearer(student.token))
      .expect(200);
    expect(cats.body.data.find((c: { name: string }) => c.name === 'Dosas').itemCount).toBe(4);

    const dosa = await itemByName(prisma, kg.id, 'Plain Dosa');
    const item = await request(app)
      .get(`/api/menu/items/${dosa.id}`)
      .set(bearer(student.token))
      .expect(200);
    expect(item.body.data).toMatchObject({
      name: 'Plain Dosa',
      pricePaise: 4_000,
      category: { name: 'Dosas' },
      canteen: { id: kg.id },
    });
  });
});

describe('staff menu management', () => {
  it('pending staff cannot manage a menu', async () => {
    const pending = await newPendingStaff(app, kg.id);
    const res = await request(app)
      .post('/api/staff/menu/categories')
      .set(bearer(pending.token))
      .send({ name: 'Nope' })
      .expect(403);
    expect(res.body.error.code).toBe('STAFF_NOT_APPROVED');
  });

  it('students and admins-as-staff are rejected on staff routes', async () => {
    const res = await request(app).get('/api/staff/menu').set(bearer(student.token)).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
    await request(app).get('/api/staff/menu').set(bearer(admin.token)).expect(403);
  });

  it('creates a category and item in the staff member’s own canteen and students see it', async () => {
    const category = await request(app)
      .post('/api/staff/menu/categories')
      .set(bearer(staffKG.token))
      // A client-supplied canteenId is ignored: the canteen comes from the database.
      .send({ name: 'Test Category', canteenId: yn.id })
      .expect(201);
    expect(category.body.data.canteenId).toBe(kg.id);

    const item = await request(app)
      .post('/api/staff/menu/items')
      .set(bearer(staffKG.token))
      .send({
        categoryId: category.body.data.id,
        name: 'Test Item',
        pricePaise: 9_900,
        description: 'Tasty',
      })
      .expect(201);
    expect(item.body.data).toMatchObject({
      canteenId: kg.id,
      pricePaise: 9_900,
      isOrderable: true,
    });

    const row = await prisma.menuItem.findUniqueOrThrow({ where: { id: item.body.data.id } });
    expect(row).toMatchObject({ name: 'Test Item', pricePaise: 9_900, canteenId: kg.id });

    const menu = await request(app)
      .get(`/api/canteens/${kg.id}/menu`)
      .set(bearer(student.token))
      .expect(200);
    const testCategory = menu.body.data.categories.find(
      (c: { name: string }) => c.name === 'Test Category',
    );
    expect(testCategory.items).toEqual([
      expect.objectContaining({ name: 'Test Item', pricePaise: 9_900 }),
    ]);
  });

  it('updates price, availability and soft-deletes items', async () => {
    const tea = await itemByName(prisma, kg.id, 'Masala Tea');
    const price = await request(app)
      .patch(`/api/staff/menu/items/${tea.id}/price`)
      .set(bearer(staffKG.token))
      .send({ pricePaise: 3_500 })
      .expect(200);
    expect(price.body.data.pricePaise).toBe(3_500);

    const off = await request(app)
      .patch(`/api/staff/menu/items/${tea.id}/availability`)
      .set(bearer(staffKG.token))
      .send({ isAvailable: false })
      .expect(200);
    expect(off.body.data).toMatchObject({ isAvailable: false, isOrderable: false });

    const menu = await request(app)
      .get(`/api/canteens/${kg.id}/menu`)
      .set(bearer(student.token))
      .expect(200);
    const listed = menu.body.data.categories
      .flatMap((c: { items: unknown[] }) => c.items)
      .find((i: { id: string }) => i.id === tea.id);
    expect(listed).toMatchObject({ pricePaise: 3_500, isAvailable: false, isOrderable: false });

    await request(app)
      .delete(`/api/staff/menu/items/${tea.id}`)
      .set(bearer(staffKG.token))
      .expect(200);
    await request(app).get(`/api/menu/items/${tea.id}`).set(bearer(student.token)).expect(404);
    expect((await prisma.menuItem.findUniqueOrThrow({ where: { id: tea.id } })).isActive).toBe(
      false,
    );
  });

  it('validates prices and duplicate names', async () => {
    const cat = await prisma.menuCategory.findFirstOrThrow({
      where: { canteenId: kg.id, name: 'Juices' },
    });
    for (const pricePaise of [0, -100, 99.5, '120']) {
      await request(app)
        .post('/api/staff/menu/items')
        .set(bearer(staffKG.token))
        .send({ categoryId: cat.id, name: `Bad ${String(pricePaise)}`, pricePaise })
        .expect(422);
    }
    const dup = await request(app)
      .post('/api/staff/menu/items')
      .set(bearer(staffKG.token))
      .send({ categoryId: cat.id, name: 'Grape Fresh Juice', pricePaise: 7_000 })
      .expect(409);
    expect(dup.body.error.code).toBe('MENU_ITEM_EXISTS');
    const dupCat = await request(app)
      .post('/api/staff/menu/categories')
      .set(bearer(staffKG.token))
      .send({ name: 'Juices' })
      .expect(409);
    expect(dupCat.body.error.code).toBe('CATEGORY_EXISTS');
  });

  it('disabling a category hides its items from students', async () => {
    const created = await request(app)
      .post('/api/staff/menu/categories')
      .set(bearer(staffKG.token))
      .send({ name: 'Seasonal' })
      .expect(201);
    await request(app)
      .post('/api/staff/menu/items')
      .set(bearer(staffKG.token))
      .send({ categoryId: created.body.data.id, name: 'Mango Shake', pricePaise: 8_000 })
      .expect(201);
    await request(app)
      .delete(`/api/staff/menu/categories/${created.body.data.id}`)
      .set(bearer(staffKG.token))
      .expect(200);
    const menu = await request(app)
      .get(`/api/canteens/${kg.id}/menu`)
      .set(bearer(student.token))
      .expect(200);
    expect(menu.body.data.categories.map((c: { name: string }) => c.name)).not.toContain(
      'Seasonal',
    );
  });
});

describe('cross-canteen isolation (menu)', () => {
  it('staff of Canteen A cannot edit, reprice or toggle Canteen B items', async () => {
    const ynCoffee = await itemByName(prisma, yn.id, 'Coffee');
    const attempts = [
      request(app)
        .patch(`/api/staff/menu/items/${ynCoffee.id}`)
        .set(bearer(staffKG.token))
        .send({ name: 'Hacked' }),
      request(app)
        .patch(`/api/staff/menu/items/${ynCoffee.id}/price`)
        .set(bearer(staffKG.token))
        .send({ pricePaise: 100 }),
      request(app)
        .patch(`/api/staff/menu/items/${ynCoffee.id}/availability`)
        .set(bearer(staffKG.token))
        .send({ isAvailable: false }),
      request(app).delete(`/api/staff/menu/items/${ynCoffee.id}`).set(bearer(staffKG.token)),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('MENU_ITEM_NOT_FOUND');
    }
    const unchanged = await prisma.menuItem.findUniqueOrThrow({ where: { id: ynCoffee.id } });
    expect(unchanged).toMatchObject({
      name: 'Coffee',
      pricePaise: 3_000,
      isAvailable: true,
      isActive: true,
    });
  });

  it('staff cannot move an item into another canteen’s category or edit its categories', async () => {
    const kgCoffee = await itemByName(prisma, kg.id, 'Coffee');
    const ynCategory = await prisma.menuCategory.findFirstOrThrow({
      where: { canteenId: yn.id, name: 'Dosas' },
    });
    const move = await request(app)
      .patch(`/api/staff/menu/items/${kgCoffee.id}`)
      .set(bearer(staffKG.token))
      .send({ categoryId: ynCategory.id })
      .expect(422);
    expect(move.body.error.code).toBe('INVALID_CATEGORY');

    await request(app)
      .patch(`/api/staff/menu/categories/${ynCategory.id}`)
      .set(bearer(staffKG.token))
      .send({ name: 'Hacked' })
      .expect(404);
    const create = await request(app)
      .post('/api/staff/menu/items')
      .set(bearer(staffKG.token))
      .send({ categoryId: ynCategory.id, name: 'Smuggled', pricePaise: 1_000 })
      .expect(422);
    expect(create.body.error.code).toBe('INVALID_CATEGORY');
  });

  it('each staff member sees only their own managed menu', async () => {
    const res = await request(app).get('/api/staff/menu').set(bearer(staffYN.token)).expect(200);
    const canteenIds = new Set(res.body.data.map((c: { canteenId: string }) => c.canteenId));
    expect([...canteenIds]).toEqual([yn.id]);
  });

  it('admins may manage any canteen’s menu', async () => {
    const ynTea = await itemByName(prisma, yn.id, 'Lemon Tea');
    const res = await request(app)
      .patch(`/api/admin/menu/items/${ynTea.id}/price`)
      .set(bearer(admin.token))
      .send({ pricePaise: 2_800 })
      .expect(200);
    expect(res.body.data.pricePaise).toBe(2_800);
    await request(app)
      .post(`/api/admin/canteens/${yn.id}/menu/categories`)
      .set(bearer(admin.token))
      .send({ name: 'Admin Specials' })
      .expect(201);
  });
});
