import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import {
  NewPlaceSchema,
  UpdatePlaceSchema,
  PlaceSubmissionSchema,
  StatusEnum,
  placesToFeatureCollection,
} from "@anime-con/shared";
import { d1PlacesRepo } from "./repo";
import { verifySession } from "./session";

type Bindings = {
  DB: D1Database;
  ADMIN_TOKEN: string;
  ALLOWED_ORIGINS?: string; // comma-separated site origins; empty = allow any (dev)
  SESSION_SECRET?: string;  // must match events-service; falls back to ADMIN_TOKEN
};

// Secret used to verify passkey session tokens minted by events-service. Both
// services must resolve to the same value (set SESSION_SECRET identically, or
// rely on the shared ADMIN_TOKEN fallback).
const sessionSecret = (env: Bindings) => env.SESSION_SECRET || env.ADMIN_TOKEN;

const app = new Hono<{ Bindings: Bindings }>();
// CORS only governs *browsers* - it does not secure the API against curl/scripts
// (the admin token does that). Here we reflect the request origin only if it's in
// ALLOWED_ORIGINS. Empty/unset reflects any origin, which is convenient for local dev.
app.use("/v1/*", cors({
  origin: (origin, c) => {
    const allowed = ((c.env as Bindings).ALLOWED_ORIGINS ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    return allowed.length === 0 ? origin : allowed.includes(origin) ? origin : null;
  },
}));

// The one place storage is chosen. Swap d1PlacesRepo(...) for mongoPlacesRepo(...) later.
const repo = (c: Context<{ Bindings: Bindings }>) => d1PlacesRepo(c.env.DB);

const requireAdmin: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const token = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const okStatic = !!c.env.ADMIN_TOKEN && token === c.env.ADMIN_TOKEN;
  const okSession = !!token && (await verifySession(sessionSecret(c.env), token));
  if (!okStatic && !okSession) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
};

const AdminUpdateSchema = UpdatePlaceSchema.extend({ status: StatusEnum.optional() });

app.get("/", (c) =>
  c.json({
    service: "places-service",
    endpoints: ["/v1/places", "/v1/places.geojson", "/v1/places/:id", "/v1/submissions", "/health"],
  }),
);
app.get("/health", (c) => c.json({ ok: true, service: "places-service" }));

// ---------- public reads ----------
app.get("/v1/places", async (c) => {
  return c.json(
    await repo(c).list({
      status: "live",
      type: c.req.query("type") || undefined,
      city: c.req.query("city") || undefined,
    }),
  );
});

app.get("/v1/places.geojson", async (c) => {
  const places = await repo(c).list({ status: "live" });
  return c.json(placesToFeatureCollection(places));
});

app.get("/v1/places/:id", async (c) => {
  const place = await repo(c).get(c.req.param("id"));
  return place ? c.json(place) : c.json({ error: "Not found" }, 404);
});

// ---------- admin writes ----------
app.post("/v1/places", requireAdmin, async (c) => {
  const parsed = NewPlaceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid place", issues: parsed.error.issues }, 400);
  const place = await repo(c).create({ ...parsed.data, status: "live" });
  return c.json(place, 201);
});

app.put("/v1/places/:id", requireAdmin, async (c) => {
  const parsed = AdminUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid update", issues: parsed.error.issues }, 400);
  const place = await repo(c).update(c.req.param("id"), parsed.data);
  return place ? c.json(place) : c.json({ error: "Not found" }, 404);
});

app.delete("/v1/places/:id", requireAdmin, async (c) => {
  await repo(c).remove(c.req.param("id"));
  return c.json({ ok: true });
});

// ---------- community submissions ----------
app.post("/v1/submissions", async (c) => {
  const parsed = PlaceSubmissionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid submission", issues: parsed.error.issues }, 400);
  const { submittedBy, ...rest } = parsed.data;
  const place = await repo(c).create({ ...rest, status: "pending", submittedBy });
  return c.json({ ok: true, id: place.id }, 201);
});

app.get("/v1/submissions", requireAdmin, async (c) => {
  return c.json(await repo(c).list({ status: "pending" }));
});

app.post("/v1/submissions/:id/approve", requireAdmin, async (c) => {
  const place = await repo(c).update(c.req.param("id"), { status: "live" });
  return place ? c.json(place) : c.json({ error: "Not found" }, 404);
});

export default app;
