import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings } from "./types";
import { eventsController } from "./controllers/events.controller";
import { placesController } from "./controllers/places.controller";
import { adminController } from "./controllers/admin.controller";
import { d1EventsRepo } from "./repositories/events.repo";
import { syncLinkedEvents } from "./services/linkedevents";
import { purgeOldQuota } from "./middleware/rate-limit";

/**
 * The merged API service: events + places + admin auth in ONE Cloudflare Worker
 * backed by ONE D1 database. This replaces the former events-service and
 * places-service (which duplicated CORS, the admin gate, and the session token
 * logic). `gis-proxy` stays its own Worker - it's a stateless cache with a
 * different failure mode.
 *
 * Layering (per the code review): controllers (HTTP) -> services (business
 * rules) -> repositories (SQL). Each controller is a Hono sub-app mounted here.
 */
const app = new Hono<{ Bindings: Bindings }>();

// CORS only governs *browsers* - it does not secure the API against curl/scripts
// (the admin token does that). Reflect the request origin only if it's in
// ALLOWED_ORIGINS. Empty/unset reflects any origin, convenient for local dev.
app.use("/v1/*", cors({
  origin: (origin, c) => {
    const allowed = ((c.env as Bindings).ALLOWED_ORIGINS ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    return allowed.length === 0 ? origin : allowed.includes(origin) ? origin : null;
  },
}));

app.get("/", (c) =>
  c.json({
    service: "api-service",
    endpoints: [
      "/v1/events", "/v1/events.geojson", "/v1/events/:id", "/v1/events/submissions",
      "/v1/places", "/v1/places.geojson", "/v1/places/:id", "/v1/places/submissions",
      "/v1/admin/status", "/health",
    ],
  }),
);
app.get("/health", (c) => c.json({ ok: true, service: "api-service" }));

// Mount each layer's controller at root; they declare their own /v1/... paths.
app.route("/", eventsController());
app.route("/", placesController());
app.route("/", adminController());

export default {
  fetch: app.fetch,
  // Cron Trigger (see wrangler.toml). Auto-imports Helsinki Linked Events; the
  // sync's own freshness guard still prevents redundant downloads. It also
  // sweeps yesterday's submission-quota counters.
  async scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(syncLinkedEvents(d1EventsRepo(env.DB), env.DB).then(() => undefined));
    ctx.waitUntil(purgeOldQuota(env.DB));
  },
};
