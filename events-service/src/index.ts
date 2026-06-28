import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import {
  NewEventSchema,
  UpdateEventSchema,
  EventSubmissionSchema,
  StatusEnum,
  eventsToFeatureCollection,
  type Event,
} from "@anime-con/shared";

type Bindings = {
  DB: D1Database;
  ADMIN_TOKEN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Public read API — allow any origin to fetch.
app.use("/v1/*", cors({ origin: "*" }));

// ---------- helpers ----------
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

const requireAdmin: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const token = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!c.env.ADMIN_TOKEN || token !== c.env.ADMIN_TOKEN) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
};

// Admin updates may also change status (NewEvent omits it).
const AdminUpdateSchema = UpdateEventSchema.extend({ status: StatusEnum.optional() });

// ---------- meta ----------
app.get("/", (c) =>
  c.json({
    service: "events-service",
    endpoints: ["/v1/events", "/v1/events.geojson", "/v1/events/:id", "/v1/submissions", "/health"],
  }),
);
app.get("/health", (c) => c.json({ ok: true, service: "events-service" }));

// ---------- public reads ----------
app.get("/v1/events", async (c) => {
  const city = c.req.query("city");
  const stmt = city
    ? c.env.DB.prepare("SELECT * FROM events WHERE status = ? AND city = ? ORDER BY date").bind("live", city)
    : c.env.DB.prepare("SELECT * FROM events WHERE status = ? ORDER BY date").bind("live");
  const { results } = await stmt.all();
  return c.json((results as Record<string, unknown>[]).map(rowToEvent));
});

app.get("/v1/events.geojson", async (c) => {
  const { results } = await c.env.DB
    .prepare("SELECT * FROM events WHERE status = ? ORDER BY date")
    .bind("live")
    .all();
  const events = (results as Record<string, unknown>[]).map(rowToEvent);
  return c.json(eventsToFeatureCollection(events));
});

app.get("/v1/events/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(c.req.param("id")).first();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(rowToEvent(row as Record<string, unknown>));
});

// ---------- admin writes ----------
app.post("/v1/events", requireAdmin, async (c) => {
  const parsed = NewEventSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid event", issues: parsed.error.issues }, 400);
  const e = parsed.data;
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO events (id,name,venue,city,date,lng,lat,description,status) VALUES (?,?,?,?,?,?,?,?,?)",
  )
    .bind(id, e.name, e.venue, e.city, e.date, e.lng, e.lat, e.description ?? null, "live")
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  return c.json(rowToEvent(row as Record<string, unknown>), 201);
});

app.put("/v1/events/:id", requireAdmin, async (c) => {
  const parsed = AdminUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid update", issues: parsed.error.issues }, 400);

  const columns: Record<string, unknown> = parsed.data;
  const allowed = ["name", "venue", "city", "date", "lng", "lat", "description", "status"];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key of allowed) {
    if (columns[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(columns[key]);
    }
  }
  if (sets.length === 0) return c.json({ error: "No fields to update" }, 400);
  vals.push(c.req.param("id"));

  await c.env.DB.prepare(`UPDATE events SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  const row = await c.env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(c.req.param("id")).first();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(rowToEvent(row as Record<string, unknown>));
});

app.delete("/v1/events/:id", requireAdmin, async (c) => {
  await c.env.DB.prepare("DELETE FROM events WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---------- community submissions ----------
app.post("/v1/submissions", async (c) => {
  const parsed = EventSubmissionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid submission", issues: parsed.error.issues }, 400);
  const e = parsed.data;
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO events (id,name,venue,city,date,lng,lat,description,status,submitted_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(id, e.name, e.venue, e.city, e.date, e.lng, e.lat, e.description ?? null, "pending", e.submittedBy ?? null)
    .run();
  return c.json({ ok: true, id }, 201);
});

app.get("/v1/submissions", requireAdmin, async (c) => {
  const { results } = await c.env.DB
    .prepare("SELECT * FROM events WHERE status = ? ORDER BY created_at DESC")
    .bind("pending")
    .all();
  return c.json((results as Record<string, unknown>[]).map(rowToEvent));
});

app.post("/v1/submissions/:id/approve", requireAdmin, async (c) => {
  await c.env.DB.prepare("UPDATE events SET status = ? WHERE id = ?").bind("live", c.req.param("id")).run();
  const row = await c.env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(c.req.param("id")).first();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(rowToEvent(row as Record<string, unknown>));
});

export default app;
