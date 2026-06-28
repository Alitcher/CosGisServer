import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import {
  NewPlaceSchema,
  UpdatePlaceSchema,
  PlaceSubmissionSchema,
  StatusEnum,
  placesToFeatureCollection,
  type Place,
} from "@anime-con/shared";

type Bindings = {
  DB: D1Database;
  ADMIN_TOKEN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("/v1/*", cors({ origin: "*" }));

// ---------- helpers ----------
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

const requireAdmin: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const token = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!c.env.ADMIN_TOKEN || token !== c.env.ADMIN_TOKEN) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
};

const AdminUpdateSchema = UpdatePlaceSchema.extend({ status: StatusEnum.optional() });

// key in payload -> { column, json? }
const FIELD_MAP: { key: string; col: string; json?: boolean }[] = [
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

// ---------- meta ----------
app.get("/", (c) =>
  c.json({
    service: "places-service",
    endpoints: ["/v1/places", "/v1/places.geojson", "/v1/places/:id", "/v1/submissions", "/health"],
  }),
);
app.get("/health", (c) => c.json({ ok: true, service: "places-service" }));

// ---------- public reads ----------
app.get("/v1/places", async (c) => {
  const type = c.req.query("type");
  const city = c.req.query("city");
  const where: string[] = ["status = ?"];
  const binds: unknown[] = ["live"];
  if (type) { where.push("type = ?"); binds.push(type); }
  if (city) { where.push("city = ?"); binds.push(city); }
  const { results } = await c.env.DB
    .prepare(`SELECT * FROM places WHERE ${where.join(" AND ")} ORDER BY name`)
    .bind(...binds)
    .all();
  return c.json((results as Record<string, unknown>[]).map(rowToPlace));
});

app.get("/v1/places.geojson", async (c) => {
  const { results } = await c.env.DB
    .prepare("SELECT * FROM places WHERE status = ? ORDER BY name")
    .bind("live")
    .all();
  const places = (results as Record<string, unknown>[]).map(rowToPlace);
  return c.json(placesToFeatureCollection(places));
});

app.get("/v1/places/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM places WHERE id = ?").bind(c.req.param("id")).first();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(rowToPlace(row as Record<string, unknown>));
});

// ---------- admin writes ----------
app.post("/v1/places", requireAdmin, async (c) => {
  const parsed = NewPlaceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid place", issues: parsed.error.issues }, 400);
  const p = parsed.data;
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO places (id,name,type,city,address,lng,lat,themes,photos,description,opening_hours,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      id, p.name, p.type, p.city, p.address ?? null, p.lng, p.lat,
      JSON.stringify(p.themes), JSON.stringify(p.photos),
      p.description ?? null, p.openingHours ?? null, "live",
    )
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM places WHERE id = ?").bind(id).first();
  return c.json(rowToPlace(row as Record<string, unknown>), 201);
});

app.put("/v1/places/:id", requireAdmin, async (c) => {
  const parsed = AdminUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid update", issues: parsed.error.issues }, 400);

  const columns: Record<string, unknown> = parsed.data;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of FIELD_MAP) {
    const v = columns[f.key];
    if (v !== undefined) {
      sets.push(`${f.col} = ?`);
      vals.push(f.json ? JSON.stringify(v) : v);
    }
  }
  if (sets.length === 0) return c.json({ error: "No fields to update" }, 400);
  vals.push(c.req.param("id"));

  await c.env.DB.prepare(`UPDATE places SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  const row = await c.env.DB.prepare("SELECT * FROM places WHERE id = ?").bind(c.req.param("id")).first();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(rowToPlace(row as Record<string, unknown>));
});

app.delete("/v1/places/:id", requireAdmin, async (c) => {
  await c.env.DB.prepare("DELETE FROM places WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---------- community submissions ----------
app.post("/v1/submissions", async (c) => {
  const parsed = PlaceSubmissionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid submission", issues: parsed.error.issues }, 400);
  const p = parsed.data;
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO places (id,name,type,city,address,lng,lat,themes,photos,description,opening_hours,status,submitted_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      id, p.name, p.type, p.city, p.address ?? null, p.lng, p.lat,
      JSON.stringify(p.themes), JSON.stringify(p.photos),
      p.description ?? null, p.openingHours ?? null, "pending", p.submittedBy ?? null,
    )
    .run();
  return c.json({ ok: true, id }, 201);
});

app.get("/v1/submissions", requireAdmin, async (c) => {
  const { results } = await c.env.DB
    .prepare("SELECT * FROM places WHERE status = ? ORDER BY created_at DESC")
    .bind("pending")
    .all();
  return c.json((results as Record<string, unknown>[]).map(rowToPlace));
});

app.post("/v1/submissions/:id/approve", requireAdmin, async (c) => {
  await c.env.DB.prepare("UPDATE places SET status = ? WHERE id = ?").bind("live", c.req.param("id")).run();
  const row = await c.env.DB.prepare("SELECT * FROM places WHERE id = ?").bind(c.req.param("id")).first();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(rowToPlace(row as Record<string, unknown>));
});

export default app;
