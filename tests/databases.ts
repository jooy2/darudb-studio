import { writeFileSync } from 'fs';
import { join } from 'path';
import { collection, Database, schema, t } from 'darudb';

/*
 * Database files for the tests to open, made with the `darudb` package in the
 * test process, as another application would make them.
 * */

export const sampleSchema = schema(1, {
  teams: collection({ name: t.string().primaryKey(), city: t.string().optional() }),
  users: collection({
    name: t.string(),
    email: t.string().optional().unique(),
    age: t.int().default(0).index(),
    score: t.float().optional(),
    tags: t.list(t.string()).optional(),
    team: t.link('teams').optional(),
    address: t.object({ city: t.string(), zip: t.string().optional() }).optional(),
    active: t.bool().default(false),
    avatar: t.bytes().optional(),
  }),
});

// A cheap hashing cost: the tests open encrypted files many times
const passwordHashing = { memoryKib: 1024, iterations: 1, parallelism: 1 };

/*
 * A file with a few teams and users, at `dir/name`: encrypted with `password`,
 * and in the format version before the newest with `olderFormat`.
 * */
export const makeSampleDatabase = (
  dir: string,
  name = 'sample.darudb',
  options: { password?: string; users?: number; olderFormat?: boolean } = {},
): string => {
  const path = join(dir, name);
  const db = Database.open(path, {
    schema: sampleSchema,
    // A file created with upgrading off is written in the older version
    ...(options.olderFormat ? { upgradeFormat: false } : {}),
    ...(options.password ? { password: options.password, passwordHashing } : {}),
  });

  db.write((txn) => {
    txn.collection('teams').insertMany([{ name: 'north', city: 'Seoul' }, { name: 'south' }]);
    txn.collection('users').insertMany(
      Array.from({ length: options.users ?? 3 }, (_, index) => ({
        name: `user ${index + 1}`,
        email: `user${index + 1}@example.com`,
        age: 20 + (index % 50),
        score: index / 2,
        tags: index % 2 === 0 ? ['red'] : [],
        team: index % 2 === 0 ? 'north' : 'south',
        address: index === 0 ? { city: 'Busan' } : null,
        active: index % 3 === 0,
        avatar: index === 0 ? new Uint8Array([0xca, 0xfe, 0x01]) : null,
      })),
    );
  });
  db.close();

  return path;
};

/* A file that is not a DaruDB database, at `dir/name` */
export const makeNotADatabase = (dir: string, name = 'notes.txt'): string => {
  const path = join(dir, name);

  writeFileSync(path, 'these are not the pages of a database\n'.repeat(200));

  return path;
};
