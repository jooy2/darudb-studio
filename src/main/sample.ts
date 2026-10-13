import { mkdir, readdir, rm } from 'fs/promises';
import { basename, join } from 'path';
import { collection, Database, schema, t } from 'darudb';
import { translate } from '@/common/translations';
import type { Project } from '@/common/projects';
import { getLanguage } from './appearance';
import { deleteProject, listProjects, samplesPath, saveProject } from './projects';

/*
 * The sample database: a small shop, with enough objects of every kind of
 * field to try the app on without a file of one's own.
 *
 * It is written fresh each time it is asked for, into the app's own samples
 * folder, and becomes a project there. Nothing it is made from is ever opened
 * itself, so a sample can be edited, broken or compacted freely. The samples
 * of a run are deleted, with their projects, as the run quits.
 *
 * Several runs of the app may share the user data folder, so a sample's file
 * is named after the process that wrote it: a run deletes its own samples as
 * it quits, and those of runs that ended without doing so as it starts.
 *
 * The data comes from a seeded generator, so every sample holds the same
 * objects. The names, addresses and numbers in it are made up.
 * */

const sampleSchema = schema(1, {
  categories: collection({
    slug: t.string().primaryKey(),
    name: t.string(),
    description: t.string().optional(),
  }),
  products: collection({
    sku: t.string().unique(),
    name: t.string().index(),
    category: t.link('categories').index(),
    price: t.float().index(),
    stock: t.int().default(0),
    active: t.bool().default(true),
    tags: t.list(t.string()).optional(),
    size: t
      .object({
        width: t.float(),
        height: t.float(),
        depth: t.float(),
        unit: t.string().default('cm'),
      })
      .optional(),
    weightGrams: t.int().optional(),
    // The product's color as three bytes, red, green and blue
    color: t.bytes().optional(),
    addedAt: t.int().index(),
  }),
  customers: collection({
    email: t.string().unique(),
    name: t.string().index(),
    city: t.string().index(),
    country: t.string(),
    vip: t.bool().default(false),
    address: t.object({
      street: t.string(),
      city: t.string(),
      postalCode: t.string().optional(),
      country: t.string(),
    }),
    phone: t.string().optional(),
    joinedAt: t.int().index(),
  }),
  orders: collection({
    customer: t.link('customers').index(),
    products: t.list(t.link('products')),
    itemCount: t.int(),
    total: t.float().index(),
    status: t.string().index(),
    // As a payment service numbers its payments, past what a double holds exactly
    paymentId: t.bigint().optional(),
    shipping: t
      .object({
        method: t.string(),
        cost: t.float(),
        trackingCode: t.string().optional(),
      })
      .optional(),
    gift: t.bool().default(false),
    note: t.string().optional(),
    placedAt: t.int().index(),
  }),
  reviews: collection({
    product: t.link('products').index(),
    customer: t.link('customers').index(),
    rating: t.int().index(),
    title: t.string(),
    body: t.string().optional(),
    helpful: t.int().default(0),
    createdAt: t.int().index(),
  }),
});

const COUNTS = { products: 160, customers: 400, orders: 2000, reviews: 1200 };

// The day the shop opened, which every date in it follows: 2024-01-01 UTC
const OPENED_AT = Date.UTC(2024, 0, 1);
const DAY = 24 * 60 * 60 * 1000;

const CATEGORIES: { slug: string; name: string; description: string | null; items: string[] }[] = [
  {
    slug: 'books',
    name: 'Books',
    description: 'Novels, guides and picture books.',
    items: ['Atlas', 'Cookbook', 'Field Guide', 'Novel', 'Poetry Collection', 'Sketchbook'],
  },
  {
    slug: 'music',
    name: 'Music',
    description: 'Records, cassettes and sheet music.',
    items: ['Vinyl Record', 'Cassette', 'Songbook', 'Harmonica', 'Metronome'],
  },
  {
    slug: 'games',
    name: 'Games',
    description: 'Board games, puzzles and cards.',
    items: ['Chess Set', 'Jigsaw Puzzle', 'Card Deck', 'Dice Set', 'Board Game'],
  },
  {
    slug: 'kitchen',
    name: 'Kitchen',
    description: 'Cookware, knives and tableware.',
    items: ['Chef Knife', 'Cutting Board', 'Teapot', 'Mixing Bowl', 'Skillet', 'Spice Rack'],
  },
  {
    slug: 'garden',
    name: 'Garden',
    description: 'Tools, seeds and planters.',
    items: ['Trowel', 'Watering Can', 'Seed Kit', 'Planter', 'Pruning Shears'],
  },
  {
    slug: 'office',
    name: 'Office',
    description: 'Desk supplies and paper goods.',
    items: ['Notebook', 'Fountain Pen', 'Desk Organizer', 'Stapler', 'Desk Lamp'],
  },
  {
    slug: 'outdoor',
    name: 'Outdoor',
    description: 'Tents, lamps and travel gear.',
    items: ['Lantern', 'Water Bottle', 'Hammock', 'Daypack', 'Tent', 'Flask'],
  },
  {
    slug: 'toys',
    name: 'Toys',
    description: null,
    items: ['Building Blocks', 'Plush Bear', 'Kite', 'Spinning Top', 'Wooden Train'],
  },
];

const MATERIALS = [
  'Classic',
  'Compact',
  'Walnut',
  'Oak',
  'Linen',
  'Copper',
  'Midnight',
  'Pocket',
  'Deluxe',
  'Handmade',
  'Vintage',
  'Bamboo',
  'Recycled',
  'Coral',
];

const TAGS = ['new', 'bestseller', 'gift', 'eco', 'limited', 'sale'];

const FIRST_NAMES = [
  'Ada',
  'Ben',
  'Chloe',
  'Daniel',
  'Elena',
  'Felix',
  'Grace',
  'Hana',
  'Ivan',
  'Jisoo',
  'Kenji',
  'Lena',
  'Mateo',
  'Nora',
  'Omar',
  'Priya',
  'Quinn',
  'Rosa',
  'Sora',
  'Theo',
  'Uma',
  'Victor',
  'Wen',
  'Yuna',
  'Zoe',
];

const LAST_NAMES = [
  'Abe',
  'Bauer',
  'Chen',
  'Dubois',
  'Evans',
  'Fischer',
  'Garcia',
  'Han',
  'Ito',
  'Jensen',
  'Kim',
  'Lopez',
  'Moreau',
  'Novak',
  'Okafor',
  'Park',
  'Rossi',
  'Silva',
  'Tanaka',
  'Weber',
];

const CITIES = [
  ['Seoul', 'South Korea'],
  ['Busan', 'South Korea'],
  ['Tokyo', 'Japan'],
  ['Osaka', 'Japan'],
  ['Berlin', 'Germany'],
  ['Hamburg', 'Germany'],
  ['Paris', 'France'],
  ['Lyon', 'France'],
  ['London', 'United Kingdom'],
  ['Toronto', 'Canada'],
  ['Chicago', 'United States'],
  ['Austin', 'United States'],
  ['Sydney', 'Australia'],
  ['Madrid', 'Spain'],
  ['Amsterdam', 'Netherlands'],
  ['Stockholm', 'Sweden'],
] as const;

const STREETS = ['Maple', 'Harbor', 'Station', 'Garden', 'Hill', 'River', 'Market', 'Lake'];
const STREET_KINDS = ['Street', 'Road', 'Avenue', 'Lane'];

const STATUSES = ['delivered', 'delivered', 'delivered', 'shipped', 'paid', 'pending', 'cancelled'];
const SHIPPING = [
  { method: 'standard', cost: 4.5 },
  { method: 'express', cost: 12 },
  { method: 'pickup', cost: 0 },
];
const NOTES = [
  'Please leave it at the door.',
  'Gift wrap, please.',
  'Call before delivery.',
  'Deliver after 6 pm.',
  'No invoice in the box, please.',
];

const REVIEW_TITLES: Record<number, string[]> = {
  1: ['Not what I expected', 'Broke in a week', 'Would not buy again'],
  2: ['Could be better', 'Smaller than it looks', 'Arrived late'],
  3: ['It is fine', 'Does the job', 'Decent for the price'],
  4: ['Very good', 'Nice quality', 'Happy with it'],
  5: ['Love it', 'Perfect gift', 'Exactly as described', 'Best purchase this year'],
};
const REVIEW_BODIES = [
  'Well made and well packed.',
  'The color is a little different from the photo.',
  'Bought a second one for a friend.',
  'Works as it should, nothing more.',
  'Took a while to arrive, but worth the wait.',
  'The instructions could be clearer.',
];

/* A generator of numbers from 0 to 1, the same ones for the same seed (mulberry32) */
const randomFrom = (seed: number) => {
  let state = seed >>> 0;

  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;

    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);

    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

/* Writes the sample database to `path`, a file that does not exist yet */
export const writeSampleDatabase = async (path: string): Promise<void> => {
  const random = randomFrom(20240101);
  const integer = (from: number, to: number): number =>
    from + Math.floor(random() * (to - from + 1));
  const pick = <Item>(items: readonly Item[]): Item => items[Math.floor(random() * items.length)];
  const chance = (odds: number): boolean => random() < odds;
  const cents = (value: number): number => Math.round(value * 100) / 100;
  const pad = (value: number, length: number): string => String(value).padStart(length, '0');
  const shuffled = <Item>(items: readonly Item[]): Item[] => {
    const copy = [...items];

    for (let at = copy.length - 1; at > 0; at -= 1) {
      const other = integer(0, at);

      [copy[at], copy[other]] = [copy[other], copy[at]];
    }

    return copy;
  };

  const database = await Database.openAsync(path, { schema: sampleSchema });

  try {
    await database.writeAsync(async (txn) => {
      await txn
        .collection('categories')
        .insertMany(CATEGORIES.map(({ slug, name, description }) => ({ slug, name, description })));

      // Each name once, in an order of the generator's
      const productNames = shuffled(
        CATEGORIES.flatMap((category) =>
          category.items.flatMap((item) =>
            MATERIALS.map((material) => ({ category, name: `${material} ${item}` })),
          ),
        ),
      );
      const products = productNames.slice(0, COUNTS.products).map(({ category, name }, at) => ({
        sku: `${category.slug.slice(0, 3).toUpperCase()}-${1001 + at}`,
        name,
        category: category.slug,
        price: cents(integer(3, 240) + 0.99),
        stock: chance(0.1) ? 0 : integer(1, 300),
        active: !chance(0.08),
        tags: chance(0.2) ? null : TAGS.filter(() => chance(0.25)).slice(0, integer(0, 3)),
        size: chance(0.3)
          ? null
          : {
              width: cents(integer(5, 900) / 10),
              height: cents(integer(5, 900) / 10),
              depth: cents(integer(5, 400) / 10),
              unit: 'cm',
            },
        weightGrams: chance(0.15) ? null : integer(40, 9000),
        color: chance(0.4)
          ? null
          : new Uint8Array([integer(0, 255), integer(0, 255), integer(0, 255)]),
        addedAt: OPENED_AT + integer(0, 300) * DAY,
      }));
      const productKeys = await txn.collection('products').insertMany(products);
      const prices = new Map(productKeys.map((key, at) => [key, products[at].price]));

      const customers = Array.from({ length: COUNTS.customers }, (_, at) => {
        const first = pick(FIRST_NAMES);
        const last = pick(LAST_NAMES);
        const [city, country] = pick(CITIES);

        return {
          email: `${first}.${last}.${at + 1}@example.com`.toLowerCase(),
          name: `${first} ${last}`,
          city,
          country,
          vip: chance(0.1),
          address: {
            street: `${integer(1, 240)} ${pick(STREETS)} ${pick(STREET_KINDS)}`,
            city,
            postalCode: chance(0.1) ? null : pad(integer(1000, 99999), 5),
            country,
          },
          phone: chance(0.35) ? null : `555-01${pad(integer(0, 99), 2)}`,
          joinedAt: OPENED_AT + integer(0, 500) * DAY + integer(0, DAY - 1),
        };
      });
      const customerKeys = await txn.collection('customers').insertMany(customers);

      await txn.collection('orders').insertMany(
        Array.from({ length: COUNTS.orders }, () => {
          const bought = Array.from({ length: integer(1, 5) }, () => pick(productKeys));
          const quantities = bought.map(() => (chance(0.8) ? 1 : integer(2, 4)));
          const status = pick(STATUSES);
          const paid = status !== 'pending' && status !== 'cancelled';
          const shipping = pick(SHIPPING);

          return {
            customer: pick(customerKeys),
            products: bought,
            itemCount: quantities.reduce((sum, count) => sum + count, 0),
            total: cents(
              bought.reduce<number>(
                (sum, key, at) => sum + (prices.get(key) ?? 0) * quantities[at],
                0,
              ) + shipping.cost,
            ),
            status,
            paymentId: paid ? (1n << 60n) + BigInt(integer(1, 2 ** 31)) * 4096n : null,
            shipping: paid
              ? {
                  method: shipping.method,
                  cost: shipping.cost,
                  trackingCode:
                    shipping.method === 'pickup' || status === 'paid'
                      ? null
                      : `TRK${pad(integer(0, 99999999), 8)}`,
                }
              : null,
            gift: chance(0.12),
            note: chance(0.15) ? pick(NOTES) : null,
            placedAt: OPENED_AT + integer(30, 640) * DAY + integer(0, DAY - 1),
          };
        }),
      );

      await txn.collection('reviews').insertMany(
        Array.from({ length: COUNTS.reviews }, () => {
          const rating = pick([1, 2, 3, 3, 4, 4, 4, 5, 5, 5, 5]);

          return {
            product: pick(productKeys),
            customer: pick(customerKeys),
            rating,
            title: pick(REVIEW_TITLES[rating]),
            body: chance(0.3) ? null : pick(REVIEW_BODIES),
            helpful: chance(0.5) ? 0 : integer(1, 60),
            createdAt: OPENED_AT + integer(40, 650) * DAY + integer(0, DAY - 1),
          };
        }),
      );
    });
  } finally {
    await database.closeAsync();
  }
};

const SAMPLE_FILE = /^sample-(\d+)-\d+\.darudb$/;

/* The process that wrote the sample at `path`, or `null` for a file not named as a sample */
const ownerOf = (path: string): number | null => {
  const match = SAMPLE_FILE.exec(basename(path));

  return match ? Number(match[1]) : null;
};

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    // A process of another user is running too, and only refuses the signal
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/*
 * Writes a sample database into the samples folder and adds it as a project,
 * named in the language of the app. Resolves with the project.
 * */
export const createSampleProject = async (): Promise<Project> => {
  const path = join(samplesPath(), `sample-${process.pid}-${Date.now()}.darudb`);

  await mkdir(samplesPath(), { recursive: true });

  try {
    await writeSampleDatabase(path);

    return await saveProject({
      name: translate(getLanguage(), 'home.sample-name'),
      filePath: path,
    });
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
};

/*
 * Deletes samples with their projects: those of this run with `own`, as it
 * quits, and with `stale`, as it starts, those of runs that are no longer
 * running, which quit without getting to it. A run started now has no samples
 * yet, so one that has its process id is an earlier one's.
 * */
export const removeSamples = async (which: 'own' | 'stale'): Promise<void> => {
  const removable = (path: string): boolean => {
    const owner = ownerOf(path);

    if (owner === null) {
      return false;
    }

    return which === 'own' ? owner === process.pid : owner === process.pid || !isRunning(owner);
  };

  try {
    for (const project of await listProjects()) {
      if (project.sample && removable(project.filePath)) {
        // Deletes the file with it
        await deleteProject(project.id);
      }
    }

    // A file whose project was never saved, as when the app stopped in between
    const files = await readdir(samplesPath()).catch(() => []);

    await Promise.all(
      files
        .map((name) => join(samplesPath(), name))
        .filter(removable)
        .map((path) => rm(path, { force: true })),
    );
  } catch (error) {
    console.error('Failed to delete the sample databases:', error);
  }
};
