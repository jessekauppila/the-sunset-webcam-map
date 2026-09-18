import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

/**
 * The Neon client, constructed on the first query rather than at import
 * (issue #243).
 *
 * `neon()` throws when DATABASE_URL is absent, so building it at module scope
 * made a connection string a requirement for merely *importing* any of the
 * ~54 route modules that use `sql`. `next build` imports all of them to
 * collect page data, which is how CI's first run failed on a build that never
 * runs a query. Deferring the construction means a build, a test, or a script
 * that imports a route needs no credentials at all.
 *
 * A missing or bad connection string still fails — just at the query, with the
 * driver's own message, which is where it is actionable.
 */
let client: NeonQueryFunction<false, false> | null = null;

function connect(): NeonQueryFunction<false, false> {
  if (!client) client = neon(process.env.DATABASE_URL!);
  return client;
}

/**
 * Used as a tagged template (`sql`SELECT 1``) in ~200 places and as
 * `sql.transaction([...])` in two, so the proxy forwards both the call and any
 * property the driver exposes.
 */
export const sql = new Proxy(function () {} as unknown as NeonQueryFunction<false, false>, {
  apply(_target, _thisArg, args: unknown[]) {
    return (connect() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_target, property) {
    const value = Reflect.get(connect() as unknown as object, property) as unknown;
    return typeof value === 'function' ? value.bind(connect()) : value;
  },
}) as NeonQueryFunction<false, false>;
