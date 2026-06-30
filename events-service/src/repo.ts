import type { Event } from "@anime-con/shared";

/**
 * Data-access seam for events.
 *
 * Route handlers depend on `EventsRepo` (an interface), never on SQL. To swap the
 * database later (MongoDB, Postgres, ...), write ONE new implementation of this
 * interface and change where the repo is constructed in `index.ts`. No route,
 * validation, or response code changes - the API contract stays identical.
 */
export type EventInput = {
  name: string;
  venue: string;
  city: Event["city"];
  date: string;
  lng: number;
  lat: number;
  description?: string;
  status?: Event["status"];
  submittedBy?: string;
  source?: string;    // provenance for imported events, e.g. 'linkedevents'
  sourceId?: string;  // upstream id within that source
};

export interface EventsRepo {
  list(filter?: { status?: string; city?: string }): Promise<Event[]>;
  get(id: string): Promise<Event | null>;
  create(input: EventInput): Promise<Event>;
  update(id: string, patch: Partial<EventInput>): Promise<Event | null>;
  remove(id: string): Promise<void>;
  /** Lookup by import provenance - used to dedupe re-imports. Null if not present. */
  findBySourceId(source: string, sourceId: string): Promise<Event | null>;
}

function rowToEvent(r: Record<string, unknown>): Event {
  return {
    id: String(r.id),
    name: String(r.name),
    venue: String(r.venue),
    city: r.city as Event["city"],
    date: String(r.date),
    lng: Number(r.lng),
    lat: Number(r.lat),
    description: r.description == null ? undefined : String(r.description),
    status: r.status as Event["status"],
    createdAt: r.created_at == null ? undefined : String(r.created_at),
  };
}

// updatable field -> column
const COLUMNS: Array<[keyof EventInput, string]> = [
  ["name", "name"], ["venue", "venue"], ["city", "city"], ["date", "date"],
  ["lng", "lng"], ["lat", "lat"], ["description", "description"], ["status", "status"],
];

/** D1 (SQLite) implementation of EventsRepo. */
export function d1EventsRepo(db: D1Database): EventsRepo {
  async function get(id: string): Promise<Event | null> {
    const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
    return row ? rowToEvent(row as Record<string, unknown>) : null;
  }

  return {
    get,

    async list(filter) {
      const where: string[] = [];
      const binds: unknown[] = [];
      if (filter?.status) { where.push("status = ?"); binds.push(filter.status); }
      if (filter?.city) { where.push("city = ?"); binds.push(filter.city); }
      const sql = `SELECT * FROM events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY date`;
      const { results } = await db.prepare(sql).bind(...binds).all();
      return (results as Record<string, unknown>[]).map(rowToEvent);
    },

    async create(input) {
      const id = crypto.randomUUID();
      await db
        .prepare(
          "INSERT INTO events (id,name,venue,city,date,lng,lat,description,status,submitted_by,source,source_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id, input.name, input.venue, input.city, input.date, input.lng, input.lat,
          input.description ?? null, input.status ?? "draft", input.submittedBy ?? null,
          input.source ?? null, input.sourceId ?? null,
        )
        .run();
      return (await get(id)) as Event;
    },

    async findBySourceId(source, sourceId) {
      const row = await db
        .prepare("SELECT * FROM events WHERE source = ? AND source_id = ?")
        .bind(source, sourceId)
        .first();
      return row ? rowToEvent(row as Record<string, unknown>) : null;
    },

    async update(id, patch) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const [key, col] of COLUMNS) {
        const v = patch[key];
        if (v !== undefined) { sets.push(`${col} = ?`); vals.push(v); }
      }
      if (sets.length > 0) {
        vals.push(id);
        await db.prepare(`UPDATE events SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
      }
      return get(id);
    },

    async remove(id) {
      await db.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
    },
  };
}
