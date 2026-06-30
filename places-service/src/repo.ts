import type { Place } from "@anime-con/shared";

/**
 * Data-access seam for places.
 *
 * Routes depend on `PlacesRepo`, never on SQL. To swap the database later, write
 * one new implementation and change the constructor in `index.ts`. The JSON-ness
 * of `themes`/`photos` (a SQLite detail) is hidden here, not in the routes.
 */
export type PlaceInput = {
  name: string;
  type: Place["type"];
  city: Place["city"];
  address?: string;
  lng: number;
  lat: number;
  themes: string[];
  photos: Place["photos"];
  description?: string;
  openingHours?: string;
  status?: Place["status"];
  submittedBy?: string;
};

export interface PlacesRepo {
  list(filter?: { status?: string; type?: string; city?: string }): Promise<Place[]>;
  get(id: string): Promise<Place | null>;
  create(input: PlaceInput): Promise<Place>;
  update(id: string, patch: Partial<PlaceInput>): Promise<Place | null>;
  remove(id: string): Promise<void>;
}

function rowToPlace(r: Record<string, unknown>): Place {
  return {
    id: String(r.id),
    name: String(r.name),
    type: r.type as Place["type"],
    city: r.city as Place["city"],
    address: r.address == null ? undefined : String(r.address),
    lng: Number(r.lng),
    lat: Number(r.lat),
    themes: JSON.parse(String(r.themes ?? "[]")) as string[],
    photos: JSON.parse(String(r.photos ?? "[]")) as Place["photos"],
    description: r.description == null ? undefined : String(r.description),
    openingHours: r.opening_hours == null ? undefined : String(r.opening_hours),
    status: r.status as Place["status"],
    createdAt: r.created_at == null ? undefined : String(r.created_at),
  };
}

// updatable field -> { column, stored as JSON? }
const FIELDS: Array<{ key: keyof PlaceInput; col: string; json?: boolean }> = [
  { key: "name", col: "name" },
  { key: "type", col: "type" },
  { key: "city", col: "city" },
  { key: "address", col: "address" },
  { key: "lng", col: "lng" },
  { key: "lat", col: "lat" },
  { key: "themes", col: "themes", json: true },
  { key: "photos", col: "photos", json: true },
  { key: "description", col: "description" },
  { key: "openingHours", col: "opening_hours" },
  { key: "status", col: "status" },
];

/** D1 (SQLite) implementation of PlacesRepo. */
export function d1PlacesRepo(db: D1Database): PlacesRepo {
  async function get(id: string): Promise<Place | null> {
    const row = await db.prepare("SELECT * FROM places WHERE id = ?").bind(id).first();
    return row ? rowToPlace(row as Record<string, unknown>) : null;
  }

  return {
    get,

    async list(filter) {
      const where: string[] = [];
      const binds: unknown[] = [];
      if (filter?.status) { where.push("status = ?"); binds.push(filter.status); }
      if (filter?.type) { where.push("type = ?"); binds.push(filter.type); }
      if (filter?.city) { where.push("city = ?"); binds.push(filter.city); }
      const sql = `SELECT * FROM places ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY name`;
      const { results } = await db.prepare(sql).bind(...binds).all();
      return (results as Record<string, unknown>[]).map(rowToPlace);
    },

    async create(input) {
      const id = crypto.randomUUID();
      await db
        .prepare(
          "INSERT INTO places (id,name,type,city,address,lng,lat,themes,photos,description,opening_hours,status,submitted_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id, input.name, input.type, input.city, input.address ?? null, input.lng, input.lat,
          JSON.stringify(input.themes ?? []), JSON.stringify(input.photos ?? []),
          input.description ?? null, input.openingHours ?? null, input.status ?? "draft", input.submittedBy ?? null,
        )
        .run();
      return (await get(id)) as Place;
    },

    async update(id, patch) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const f of FIELDS) {
        const v = patch[f.key];
        if (v !== undefined) { sets.push(`${f.col} = ?`); vals.push(f.json ? JSON.stringify(v) : v); }
      }
      if (sets.length > 0) {
        vals.push(id);
        await db.prepare(`UPDATE places SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
      }
      return get(id);
    },

    async remove(id) {
      await db.prepare("DELETE FROM places WHERE id = ?").bind(id).run();
    },
  };
}
