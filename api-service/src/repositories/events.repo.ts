import type { Event, I18n, Transit } from "@anime-con/shared";

/** i18n JSON column -> object (bad or empty JSON = none). */
export function parseI18n(v: unknown): I18n | undefined {
  if (v == null || v === "") return undefined;
  try {
    const o = JSON.parse(String(v)) as I18n;
    return o && typeof o === "object" ? o : undefined;
  } catch {
    return undefined;
  }
}

/** recurrence JSON column -> object (NULL or bad JSON = does not repeat). */
export function parseRecurrence(v: unknown): Event["recurrence"] {
  if (v == null || v === "") return undefined;
  try {
    const o = JSON.parse(String(v));
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Event["recurrence"]) : undefined;
  } catch {
    return undefined;
  }
}

/** transit JSON column -> array (NULL = never checked, bad JSON = treated the same). */
export function parseTransit(v: unknown): Transit | undefined {
  if (v == null || v === "") return undefined;
  try {
    const o = JSON.parse(String(v)) as Transit;
    return Array.isArray(o) ? o : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Data-access seam for events.
 *
 * Services depend on `EventsRepo` (an interface), never on SQL. To swap the
 * database later (MongoDB, Postgres, ...), write ONE new implementation of this
 * interface and change where the repo is constructed. No service, validation, or
 * response code changes - the API contract stays identical.
 */
export type EventInput = {
  name: string;
  venue: string;
  city: Event["city"];
  country?: Event["country"]; // missing = 'FI'
  lang?: Event["lang"];       // language of name/description
  i18n?: Event["i18n"];       // translations, stored as JSON
  transit?: Event["transit"]; // nearby stops, stored as JSON
  date: string;
  endDate?: string;
  lng: number;
  lat: number;
  description?: string;
  url?: string;       // link to the event's info page
  image?: string;     // thumbnail / logo URL
  admission?: Event["admission"]; // free | paid | mixed
  priceMin?: number;  // EUR
  priceMax?: number;  // EUR
  priceNote?: string;
  ageMin?: number | null; // suggested ages, null clears
  ageMax?: number | null;
  kind?: Event["kind"];             // convention | community
  recurrence?: Event["recurrence"]; // stored as JSON, null clears
  startTime?: string; // local 'HH:MM'
  endTime?: string;   // local 'HH:MM'
  status?: Event["status"];
  submittedBy?: string;
  source?: string;    // provenance for imported events, e.g. 'linkedevents'
  sourceId?: string;  // upstream id within that source
};

export interface EventsRepo {
  list(filter?: { status?: string; city?: string; country?: string }): Promise<Event[]>;
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
    city: String(r.city),
    country: (r.country ?? "FI") as Event["country"],
    lang: r.lang == null ? undefined : (r.lang as Event["lang"]),
    i18n: parseI18n(r.i18n),
    transit: parseTransit(r.transit),
    date: String(r.date),
    endDate: r.end_date == null ? undefined : String(r.end_date),
    lng: Number(r.lng),
    lat: Number(r.lat),
    description: r.description == null ? undefined : String(r.description),
    url: r.url == null ? undefined : String(r.url),
    image: r.image == null ? undefined : String(r.image),
    admission: r.admission == null ? undefined : (r.admission as Event["admission"]),
    priceMin: r.price_min == null ? undefined : Number(r.price_min),
    priceMax: r.price_max == null ? undefined : Number(r.price_max),
    priceNote: r.price_note == null ? undefined : String(r.price_note),
    ageMin: r.age_min == null ? undefined : Number(r.age_min),
    ageMax: r.age_max == null ? undefined : Number(r.age_max),
    kind: r.kind == null ? undefined : (r.kind as Event["kind"]),
    recurrence: parseRecurrence(r.recurrence),
    startTime: r.start_time == null ? undefined : String(r.start_time),
    endTime: r.end_time == null ? undefined : String(r.end_time),
    status: r.status as Event["status"],
    createdAt: r.created_at == null ? undefined : String(r.created_at),
  };
}

// updatable field -> column
const COLUMNS: Array<[keyof EventInput, string]> = [
  ["name", "name"], ["venue", "venue"], ["city", "city"], ["country", "country"], ["lang", "lang"], ["i18n", "i18n"], ["transit", "transit"], ["date", "date"], ["endDate", "end_date"],
  ["lng", "lng"], ["lat", "lat"], ["description", "description"], ["url", "url"], ["image", "image"],
  ["admission", "admission"], ["priceMin", "price_min"], ["priceMax", "price_max"], ["priceNote", "price_note"],
  ["ageMin", "age_min"], ["ageMax", "age_max"], ["kind", "kind"], ["recurrence", "recurrence"],
  ["startTime", "start_time"], ["endTime", "end_time"], ["status", "status"],
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
      if (filter?.country) { where.push("country = ?"); binds.push(filter.country); }
      const sql = `SELECT * FROM events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY date`;
      const { results } = await db.prepare(sql).bind(...binds).all();
      return (results as Record<string, unknown>[]).map(rowToEvent);
    },

    async create(input) {
      const id = crypto.randomUUID();
      await db
        .prepare(
          "INSERT INTO events (id,name,venue,city,country,lang,i18n,transit,date,end_date,start_time,end_time,lng,lat,description,url,image,admission,price_min,price_max,price_note,age_min,age_max,kind,recurrence,status,submitted_by,source,source_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id, input.name, input.venue, input.city, input.country ?? "FI", input.lang ?? null,
          input.i18n ? JSON.stringify(input.i18n) : null, input.transit ? JSON.stringify(input.transit) : null, input.date, input.endDate ?? null,
          input.startTime ?? null, input.endTime ?? null, input.lng, input.lat,
          input.description ?? null, input.url ?? null, input.image ?? null,
          input.admission ?? null, input.priceMin ?? null, input.priceMax ?? null, input.priceNote ?? null,
          input.ageMin ?? null, input.ageMax ?? null,
          input.kind ?? null, input.recurrence ? JSON.stringify(input.recurrence) : null, input.status ?? "draft", input.submittedBy ?? null,
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
        if (v !== undefined) { sets.push(`${col} = ?`); vals.push((key === "i18n" || key === "transit" || key === "recurrence") && v !== null ? JSON.stringify(v) : v); }
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
