import type { Place } from "@anime-con/shared";

/**
 * Data-access seam for places.
 *
 * Services depend on `PlacesRepo`, never on SQL. To swap the database later, write
 * one new implementation and change the constructor. The JSON-ness of
 * `themes`/`photos` (a SQLite detail) is hidden here, not in the services.
 */
export type PlaceInput = {
  name: string;
  type: Place["type"];
  city: Place["city"];
  country?: Place["country"]; // missing = 'FI'
  address?: string;
  lng: number;
  lat: number;
  themes: string[];
  photos: Place["photos"];
  description?: string;
  openingHours?: string;
  booking?: Place["booking"];
  price?: Place["price"];
  priceNote?: string;
  facilities?: Place["facilities"];
  youthFriendly?: boolean;
  bookingUrl?: string;
  status?: Place["status"];
  submittedBy?: string;
};

export interface PlacesRepo {
  /** `types` matches any of the listed types (e.g. every practice type). */
  list(filter?: { status?: string; type?: string; types?: string[]; city?: string; country?: string }): Promise<Place[]>;
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
    city: String(r.city),
    country: (r.country ?? "FI") as Place["country"],
    address: r.address == null ? undefined : String(r.address),
    lng: Number(r.lng),
    lat: Number(r.lat),
    themes: JSON.parse(String(r.themes ?? "[]")) as string[],
    photos: JSON.parse(String(r.photos ?? "[]")) as Place["photos"],
    description: r.description == null ? undefined : String(r.description),
    openingHours: r.opening_hours == null ? undefined : String(r.opening_hours),
    booking: r.booking == null ? undefined : (r.booking as Place["booking"]),
    price: r.price == null ? undefined : (r.price as Place["price"]),
    priceNote: r.price_note == null ? undefined : String(r.price_note),
    facilities: JSON.parse(String(r.facilities ?? "[]")) as Place["facilities"],
    youthFriendly: r.youth_friendly == null ? undefined : Number(r.youth_friendly) === 1,
    bookingUrl: r.booking_url == null ? undefined : String(r.booking_url),
    status: r.status as Place["status"],
    createdAt: r.created_at == null ? undefined : String(r.created_at),
  };
}

// updatable field -> { column, stored as JSON? stored as 0/1? }
const FIELDS: Array<{ key: keyof PlaceInput; col: string; json?: boolean; bool?: boolean }> = [
  { key: "name", col: "name" },
  { key: "type", col: "type" },
  { key: "city", col: "city" },
  { key: "country", col: "country" },
  { key: "address", col: "address" },
  { key: "lng", col: "lng" },
  { key: "lat", col: "lat" },
  { key: "themes", col: "themes", json: true },
  { key: "photos", col: "photos", json: true },
  { key: "description", col: "description" },
  { key: "openingHours", col: "opening_hours" },
  { key: "booking", col: "booking" },
  { key: "price", col: "price" },
  { key: "priceNote", col: "price_note" },
  { key: "facilities", col: "facilities", json: true },
  { key: "youthFriendly", col: "youth_friendly", bool: true },
  { key: "bookingUrl", col: "booking_url" },
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
      if (filter?.types) {
        // An empty list matches nothing (and `IN ()` is a syntax error in SQLite).
        if (filter.types.length === 0) return [];
        where.push(`type IN (${filter.types.map(() => "?").join(", ")})`);
        binds.push(...filter.types);
      }
      if (filter?.city) { where.push("city = ?"); binds.push(filter.city); }
      if (filter?.country) { where.push("country = ?"); binds.push(filter.country); }
      const sql = `SELECT * FROM places ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY name`;
      const { results } = await db.prepare(sql).bind(...binds).all();
      return (results as Record<string, unknown>[]).map(rowToPlace);
    },

    async create(input) {
      const id = crypto.randomUUID();
      await db
        .prepare(
          "INSERT INTO places (id,name,type,city,country,address,lng,lat,themes,photos,description,opening_hours,booking,price,price_note,facilities,youth_friendly,booking_url,status,submitted_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id, input.name, input.type, input.city, input.country ?? "FI", input.address ?? null, input.lng, input.lat,
          JSON.stringify(input.themes ?? []), JSON.stringify(input.photos ?? []),
          input.description ?? null, input.openingHours ?? null,
          input.booking ?? null, input.price ?? null, input.priceNote ?? null,
          JSON.stringify(input.facilities ?? []),
          input.youthFriendly == null ? null : input.youthFriendly ? 1 : 0,
          input.bookingUrl ?? null,
          input.status ?? "draft", input.submittedBy ?? null,
        )
        .run();
      return (await get(id)) as Place;
    },

    async update(id, patch) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const f of FIELDS) {
        const v = patch[f.key];
        if (v !== undefined) { sets.push(`${f.col} = ?`); vals.push(f.json ? JSON.stringify(v) : f.bool ? (v ? 1 : 0) : v); }
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
