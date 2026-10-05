import type { PrismaClient } from '../lib/prisma.js';

/**
 * Deterministic development seed data.
 *
 * Idempotent and non-destructive: every record is upserted by its natural key
 * with an empty `update`, so re-running never duplicates rows and never
 * overwrites changes made through the app (e.g. a price edited by staff).
 *
 * Frontends must never depend on these values; they read everything through
 * the API.
 */

interface SeedCanteen {
  slug: string;
  name: string;
  location: string;
  hostels: string[];
}

export const SEED_CANTEENS: readonly SeedCanteen[] = [
  {
    slug: 'krishna-godavari',
    name: 'Krishna & Godavari Night Canteen',
    location: 'Between Krishna and Godavari hostels',
    hostels: ['Krishna', 'Godavari'],
  },
  {
    slug: 'yamuna-narmada',
    name: 'Yamuna & Narmada Night Canteen',
    location: 'Between Yamuna and Narmada hostels',
    hostels: ['Yamuna', 'Narmada'],
  },
  {
    slug: 'new-hostel',
    name: 'New Hostel Night Canteen',
    location: 'New Hostel ground floor',
    hostels: ['New Hostel'],
  },
  {
    slug: 'vedavathi',
    name: 'Vedavathi Night Canteen',
    location: 'Vedavathi hostel courtyard',
    hostels: ['Vedavathi'],
  },
  {
    slug: 'ganga-a-b',
    name: 'Ganga A & Ganga B Night Canteen',
    location: 'Between Ganga A and Ganga B hostels',
    hostels: ['Ganga A', 'Ganga B'],
  },
];

const SEED_OPENING_HOURS = '9:00 PM – 3:00 AM';

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

export interface SeedResult {
  canteens: number;
  hostels: number;
  categories: number;
  items: number;
}

export async function seedDatabase(prisma: PrismaClient): Promise<SeedResult> {
  const result: SeedResult = { canteens: 0, hostels: 0, categories: 0, items: 0 };

  for (const seedCanteen of SEED_CANTEENS) {
    const canteen = await prisma.canteen.upsert({
      where: { slug: seedCanteen.slug },
      update: {},
      create: {
        slug: seedCanteen.slug,
        name: seedCanteen.name,
        location: seedCanteen.location,
        openingHours: SEED_OPENING_HOURS,
      },
    });
    result.canteens += 1;

    for (const hostelName of seedCanteen.hostels) {
      await prisma.hostel.upsert({
        where: { name: hostelName },
        update: {},
        create: { name: hostelName, canteenId: canteen.id },
      });
      result.hostels += 1;
    }

    for (const [index, section] of SEED_MENU.entries()) {
      const category = await prisma.menuCategory.upsert({
        where: { canteenId_name: { canteenId: canteen.id, name: section.category } },
        update: {},
        create: { canteenId: canteen.id, name: section.category, sortOrder: (index + 1) * 10 },
      });
      result.categories += 1;

      for (const item of section.items) {
        await prisma.menuItem.upsert({
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
      }
    }
  }

  return result;
}
