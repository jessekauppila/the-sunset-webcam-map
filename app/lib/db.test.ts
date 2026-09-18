import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The client is constructed lazily (issue #243). Importing a route module must
 * not require a connection string, because `next build` imports every route to
 * collect page data and CI imports them to run tests. Both were only working
 * because something upstream happened to supply DATABASE_URL.
 */
describe('app/lib/db', () => {
  const saved = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  });

  test('imports with no DATABASE_URL in the environment', async () => {
    await expect(import('@/app/lib/db')).resolves.toMatchObject({
      sql: expect.anything(),
    });
  });

  test('a query with no connection string still fails, rather than failing quietly', async () => {
    const { sql } = await import('@/app/lib/db');

    // The driver validates the connection string when the client is built,
    // which is now the first query — so this throws where the query is
    // written, not on a rejected promise. Every call site either awaits or
    // sits inside an async function, so the same try/catch still sees it.
    expect(() => sql`SELECT 1`).toThrow(/No database connection string/);
  });

  test('reads the connection string when the first query runs, not when the module loads', async () => {
    const { sql } = await import('@/app/lib/db');
    // Set after import: a module-scope client would already have captured the
    // absent value and would fail on a URL it never saw.
    process.env.DATABASE_URL = 'postgres://u:p@db.example.invalid/neondb';

    await expect(sql`SELECT 1`).rejects.toThrow(/db\.example\.invalid|fetch|network|ENOTFOUND|EAI_AGAIN/i);
  });
});
