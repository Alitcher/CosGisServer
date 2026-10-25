import type { Context } from "hono";
import type { Bindings } from "../types";

/**
 * Local dev only, when the admin picked "This computer + live site": a D1Database whose writes go to production first, then to the
 * local DB, so saving an event or place on your machine also saves it on the live
 * site (same id in both). Reads come from the local DB.
 *
 * If the production write fails (offline, not logged in), the request fails and
 * the local DB is left unchanged, so the two never drift apart.
 *
 * Only the events/places repos use this. Admin passkeys, sessions and quotas stay local.
 */
function mirrored(local: D1Database, prod: D1Database): D1Database {
  const statement = (l: D1PreparedStatement, p: D1PreparedStatement): D1PreparedStatement =>
    ({
      bind: (...values: unknown[]) => statement(l.bind(...values), p.bind(...values)),
      run: async () => {
        await p.run();
        return l.run();
      },
      first: (col?: string) => (col === undefined ? l.first() : l.first(col)),
      all: () => l.all(),
      raw: (opts?: { columnNames?: boolean }) => l.raw(opts as { columnNames: true }),
    }) as unknown as D1PreparedStatement;

  return { prepare: (sql: string) => statement(local.prepare(sql), prod.prepare(sql)) } as unknown as D1Database;
}

const isLocalhost = (url: string) => ["localhost", "127.0.0.1"].includes(new URL(url).hostname);

/**
 * The DB for the events/places repos. On your machine (`wrangler dev`, PROD_DB bound
 * remotely) the local admin chooses per request with the `X-Write-Target` header:
 * "both" = also save to production (mirrored), anything else / missing = this computer
 * only. On the live Worker it is always plain `DB` (production).
 */
export function contentDb(c: Context<{ Bindings: Bindings }>): D1Database {
  const both = c.req.header("X-Write-Target") === "both";
  return c.env.PROD_DB && isLocalhost(c.req.url) && both ? mirrored(c.env.DB, c.env.PROD_DB) : c.env.DB;
}
