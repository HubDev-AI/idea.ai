import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresThesisStore } from '../src/runtime/postgres_thesis_store';

const DB_URL = process.env.DATABASE_URL;

describe.skipIf(!DB_URL)('thesis store — stats filter alignment', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DB_URL! });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('stats.total matches total_items when filtered by profile', async () => {
    const store = createPostgresThesisStore({ pool });
    const page = await store.listPaginated({ profile: 'consumer' });
    // The stats total must equal the filtered count, not all theses
    expect(page.stats.total).toBe(page.total_items);
  });
});
