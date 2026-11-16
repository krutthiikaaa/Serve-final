import type { PrismaClient } from '../lib/prisma.js';

/**
 * Deterministic development seed data.
 *
 * Idempotent and non-destructive: every record is upserted by its natural key
 * with an empty `update`, so re-running never duplicates rows and never
 * overwrites changes made through the app (e.g. a price edited by staff).
 * Each service area gets a NIGHT canteen (taking orders) and a DAY canteen
 * (not taking orders, so Day/Night exclusivity holds). Each canteen gets a
 * FORCE_OPEN service for its own type and no schedule rows; each menu item a
 * MenuItemService for that type copying the catalogue price. Operating hours
 * and CASHIER are not seeded. Each canteen gets a test-mode (DEMO) payment
 * config with no official UPI/QR (never LIVE, never an invented VPA).
 *
 * Frontends must never depend on these values; they read everything through
 * the API.
 */

interface SeedCanteen {
  /** Night canteen slug; also the service area's slug. */
  slug: string;
  /** Night canteen name. */
  name: string;
  /** Service area name. */
  area: string;
  location: string;
  hostels: string[];
}

export const SEED_CANTEENS: readonly SeedCanteen[] = [
  {
    slug: 'krishna-godavari',
    area: 'Krishna & Godavari',
    name: 'Krishna & Godavari Night Canteen',
    location: 'Between Krishna and Godavari hostels',
    hostels: ['Krishna', 'Godavari'],
  },
  {
    slug: 'yamuna-narmada',
    area: 'Yamuna & Narmada',
    name: 'Yamuna & Narmada Night Canteen',
    location: 'Between Yamuna and Narmada hostels',
    hostels: ['Yamuna', 'Narmada'],
  },
  {
    slug: 'new-hostel',
    area: 'New Hostel',
    name: 'New Hostel Night Canteen',
    location: 'New Hostel ground floor',
    hostels: ['New Hostel'],
  },
  {
    slug: 'vedavathi',
    area: 'Vedavathi',
    name: 'Vedavathi Night Canteen',
    location: 'Vedavathi hostel courtyard',
    hostels: ['Vedavathi'],
  },
  {
    slug: 'ganga-a-b',
    area: 'Ganga A & Ganga B',
    name: 'Ganga A & Ganga B Night Canteen',
    location: 'Between Ganga A and Ganga B hostels',
    hostels: ['Ganga A', 'Ganga B'],
  },
];

const SEED_OPENING_HOURS = '9:00 PM – 3:00 AM';
const SEED_DAY_OPENING_HOURS = '8:00 AM – 8:00 PM';

/** Day canteen of a seeded area: "<Area> Day Canteen", slug "<area-slug>-day". */
export const dayCanteenOf = (seed: Pick<SeedCanteen, 'slug' | 'area'>) => ({
  slug: `${seed.slug}-day`,
  name: `${seed.area} Day Canteen`,
});

interface SeedItem {
  name: string;
  description: string;
  /** Rupees in this table for readability; stored as paise. */
  priceRupees: number;
}

export const SEED_MENU: readonly { category: string; items: SeedItem[] }[] = [
  {
    category: 'Sandwiches',
    items: [
      {
        name: 'Veg Grilled Sandwich',
        description: 'Grilled sandwich with fresh vegetables and green chutney.',
        priceRupees: 50,
      },
      {
        name: 'Veg Cheese Grilled Sandwich',
        description: 'Vegetable grilled sandwich with melted cheese.',
        priceRupees: 60,
      },
      {
        name: 'Chicken Grilled Sandwich',
        description: 'Grilled sandwich filled with spiced chicken.',
        priceRupees: 70,
      },
      {
        name: 'Chicken Cheese Grilled Sandwich',
        description: 'Spiced chicken and melted cheese, grilled crisp.',
        priceRupees: 85,
      },
      {
        name: 'Paneer Grilled Sandwich',
        description: 'Grilled sandwich with masala paneer.',
        priceRupees: 75,
      },
    ],
  },
  {
    category: 'Desi Bite Bites',
    items: [
      { name: 'Veg Roll', description: 'Paratha roll with spiced vegetables.', priceRupees: 70 },
      { name: 'Veg Cheese Roll', description: 'Vegetable roll with cheese.', priceRupees: 85 },
      { name: 'Chicken Roll', description: 'Paratha roll with spiced chicken.', priceRupees: 90 },
      {
        name: 'Double Egg Chicken Roll',
        description: 'Chicken roll layered with two eggs.',
        priceRupees: 90,
      },
      { name: 'Egg Chicken Roll', description: 'Chicken roll layered with egg.', priceRupees: 85 },
      {
        name: 'Chicken Cheese Roll',
        description: 'Chicken roll with melted cheese.',
        priceRupees: 110,
      },
      {
        name: 'Egg Roll',
        description: 'Paratha roll layered with egg and onions.',
        priceRupees: 70,
      },
      { name: 'Paneer Roll', description: 'Paratha roll with masala paneer.', priceRupees: 100 },
    ],
  },
  {
    category: 'Omelettes',
    items: [
      {
        name: 'Masala Omelette',
        description: 'Two-egg omelette with onion, chilli and coriander.',
        priceRupees: 35,
      },
      {
        name: 'Bread Omelette',
        description: 'Masala omelette with toasted bread.',
        priceRupees: 50,
      },
      {
        name: 'Cheese Bread Omelette',
        description: 'Bread omelette with melted cheese.',
        priceRupees: 60,
      },
    ],
  },
  {
    category: 'Juices',
    items: [
      { name: 'Banana Fresh Juice', description: 'Freshly blended banana juice.', priceRupees: 60 },
      {
        name: 'Muskmelon Fresh Juice',
        description: 'Freshly blended muskmelon juice.',
        priceRupees: 60,
      },
      {
        name: 'Watermelon Fresh Juice',
        description: 'Freshly blended watermelon juice.',
        priceRupees: 60,
      },
      { name: 'Grape Fresh Juice', description: 'Freshly blended grape juice.', priceRupees: 70 },
    ],
  },
  {
    category: 'Dosas',
    items: [
      { name: 'Plain Dosa', description: 'Crisp dosa served with chutney.', priceRupees: 40 },
      { name: 'Egg Dosa', description: 'Dosa topped with egg.', priceRupees: 50 },
      { name: 'Double Egg Dosa', description: 'Dosa topped with two eggs.', priceRupees: 60 },
      { name: 'Onion Dosa', description: 'Dosa topped with onions.', priceRupees: 50 },
    ],
  },
  {
    category: 'Hot Beverages',
    items: [
      { name: 'Coffee', description: 'Hot filter-style coffee.', priceRupees: 30 },
      { name: 'Cardamom Tea', description: 'Tea brewed with cardamom.', priceRupees: 25 },
      { name: 'Masala Tea', description: 'Tea brewed with masala spices.', priceRupees: 25 },
      { name: 'Lemon Tea', description: 'Light tea with lemon.', priceRupees: 25 },
      { name: 'Hot Milk', description: 'A glass of hot milk.', priceRupees: 30 },
    ],
  },
];

/** Daytime menu for Day canteens. */
export const SEED_DAY_MENU: readonly { category: string; items: SeedItem[] }[] = [
  {
    category: 'Breakfast',
    items: [
      {
        name: 'Idli (2 pcs)',
        description: 'Steamed idli with sambar and chutney.',
        priceRupees: 35,
      },
      { name: 'Vada (2 pcs)', description: 'Crisp medu vada with chutney.', priceRupees: 40 },
      { name: 'Upma', description: 'Semolina upma with vegetables.', priceRupees: 35 },
      {
        name: 'Poha',
        description: 'Flattened rice with peanuts and curry leaves.',
        priceRupees: 35,
      },
      { name: 'Masala Dosa', description: 'Dosa filled with spiced potato.', priceRupees: 55 },
    ],
  },
  {
    category: 'Meals',
    items: [
      { name: 'Veg Meals', description: 'Rice, dal, sabzi, curd and papad.', priceRupees: 80 },
      { name: 'Curd Rice', description: 'Rice with seasoned curd.', priceRupees: 50 },
      { name: 'Lemon Rice', description: 'Tangy rice with peanuts.', priceRupees: 50 },
      {
        name: 'Chapati with Kurma',
        description: 'Two chapatis with vegetable kurma.',
        priceRupees: 60,
      },
    ],
  },
  {
    category: 'Snacks',
    items: [
      { name: 'Samosa (2 pcs)', description: 'Potato samosas with chutney.', priceRupees: 30 },
      { name: 'Veg Puff', description: 'Flaky pastry with spiced vegetables.', priceRupees: 25 },
      { name: 'Bread Omelette', description: 'Omelette with toasted bread.', priceRupees: 45 },
    ],
  },
  {
    category: 'Hot Beverages',
    items: [
      { name: 'Coffee', description: 'Hot filter-style coffee.', priceRupees: 25 },
      { name: 'Masala Tea', description: 'Tea brewed with masala spices.', priceRupees: 20 },
      { name: 'Hot Milk', description: 'A glass of hot milk.', priceRupees: 25 },
    ],
  },
];

export interface SeedResult {
  canteens: number;
  hostels: number;
  categories: number;
  items: number;
}

export async function seedDatabase(prisma: PrismaClient): Promise<SeedResult> {
  const result: SeedResult = { canteens: 0, hostels: 0, categories: 0, items: 0 };

  for (const seed of SEED_CANTEENS) {
    const area = await prisma.serviceArea.upsert({
      where: { slug: seed.slug },
      update: {},
      create: { slug: seed.slug, name: seed.area },
    });

    const night = await prisma.canteen.upsert({
      where: { slug: seed.slug },
      update: {},
      create: {
        slug: seed.slug,
        name: seed.name,
        type: 'NIGHT',
        serviceAreaId: area.id,
        location: seed.location,
        openingHours: SEED_OPENING_HOURS,
      },
    });
    const day = dayCanteenOf(seed);
    const dayCanteen = await prisma.canteen.upsert({
      where: { slug: day.slug },
      update: {},
      create: {
        slug: day.slug,
        name: day.name,
        type: 'DAY',
        serviceAreaId: area.id,
        location: seed.location,
        openingHours: SEED_DAY_OPENING_HOURS,
        // The Night canteen of the area takes orders; Day/Night are exclusive.
        isAcceptingOrders: false,
      },
    });

    for (const hostelName of seed.hostels) {
      await prisma.hostel.upsert({
        where: { name: hostelName },
        update: {},
        create: { name: hostelName, serviceAreaId: area.id, canteenId: night.id },
      });
      result.hostels += 1;
    }

    for (const [canteen, menu] of [
      [night, SEED_MENU],
      [dayCanteen, SEED_DAY_MENU],
    ] as const) {
      await seedCanteen(prisma, canteen, menu, result);
    }
  }

  return result;
}

async function seedCanteen(
  prisma: PrismaClient,
  canteen: { id: string; type: 'DAY' | 'NIGHT' },
  menu: readonly { category: string; items: SeedItem[] }[],
  result: SeedResult,
) {
  result.canteens += 1;
  await prisma.canteenService.upsert({
    where: { canteenId_period: { canteenId: canteen.id, period: canteen.type } },
    update: {},
    create: {
      canteenId: canteen.id,
      period: canteen.type,
      isEnabled: true,
      override: 'FORCE_OPEN',
    },
  });

  await prisma.canteenPaymentConfig.upsert({
    where: { canteenId: canteen.id },
    update: {},
    create: { canteenId: canteen.id, mode: 'DEMO', isActive: false },
  });

  for (const [index, section] of menu.entries()) {
    const category = await prisma.menuCategory.upsert({
      where: { canteenId_name: { canteenId: canteen.id, name: section.category } },
      update: {},
      create: { canteenId: canteen.id, name: section.category, sortOrder: (index + 1) * 10 },
    });
    result.categories += 1;

    for (const item of section.items) {
      const menuItem = await prisma.menuItem.upsert({
        where: { canteenId_name: { canteenId: canteen.id, name: item.name } },
        update: {},
        create: {
          canteenId: canteen.id,
          categoryId: category.id,
          name: item.name,
          description: item.description,
          pricePaise: item.priceRupees * 100,
          // No stock photography is bundled; clients render category
          // placeholders until real image URLs are set by staff.
          imageUrl: null,
        },
      });
      result.items += 1;

      await prisma.menuItemService.upsert({
        where: { menuItemId_period: { menuItemId: menuItem.id, period: canteen.type } },
        update: {},
        create: {
          menuItemId: menuItem.id,
          period: canteen.type,
          pricePaise: menuItem.pricePaise,
          isAvailable: menuItem.isAvailable,
        },
      });
    }
  }
}
