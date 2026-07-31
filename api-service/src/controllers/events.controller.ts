import { Hono, type Context } from "hono";
import {
  NewEventSchema,
  UpdateEventSchema,
  EventSubmissionSchema,
  StatusEnum,
  eventsToFeatureCollection,
} from "@anime-con/shared";
import type { Bindings } from "../types";
import { requireAdmin } from "../middleware/auth";
import { d1EventsRepo } from "../repositories/events.repo";
import { eventsService } from "../services/events.service";
import { syncLinkedEvents } from "../services/linkedevents";

// Admin updates may also change status (NewEvent omits it).
const AdminUpdateSchema = UpdateEventSchema.extend({ status: StatusEnum.optional() });

/**
 * HTTP layer for events: parse + validate the request, delegate to the service,
 * shape the response. No SQL and no business rules live here.
 *
 * NOTE: submissions moved from the old flat `/v1/submissions` to
 * `/v1/events/submissions` so events and places can coexist in one Worker without
 * their submission routes colliding. Static segments are registered before the
 * `/:id` param route so e.g. `/v1/events/submissions` isn't captured as an id.
 */
export function eventsController() {
  const routes = new Hono<{ Bindings: Bindings }>();
  const svc = (c: Context<{ Bindings: Bindings }>) => eventsService(d1EventsRepo(c.env.DB));

  // ---------- public reads ----------
  routes.get("/v1/events.geojson", async (c) => {
    return c.json(eventsToFeatureCollection(await svc(c).listLive()));
  });

  // ---------- community submissions (static, before /:id) ----------
  routes.post("/v1/events/submissions", async (c) => {
    const parsed = EventSubmissionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid submission", issues: parsed.error.issues }, 400);
    const event = await svc(c).submit(parsed.data);
    return c.json({ ok: true, id: event.id }, 201);
  });

  routes.get("/v1/events/submissions", requireAdmin, async (c) => {
    return c.json(await svc(c).listPending());
  });

  routes.post("/v1/events/submissions/:id/approve", requireAdmin, async (c) => {
    const event = await svc(c).approve(c.req.param("id"));
    return event ? c.json(event) : c.json({ error: "Not found" }, 404);
  });

  // ---------- Helsinki Linked Events import ----------
  // `?force=1` bypasses the 12h freshness guard. Imports land as pending.
  routes.post("/v1/events/sync/linkedevents", requireAdmin, async (c) => {
    const force = ["1", "true"].includes((c.req.query("force") ?? "").toLowerCase());
    const result = await syncLinkedEvents(d1EventsRepo(c.env.DB), c.env.DB, { force });
    return c.json(result);
  });

  // ---------- list + create ----------
  routes.get("/v1/events", async (c) => {
    const city = c.req.query("city");
    return c.json(await svc(c).listLive(city || undefined));
  });

  routes.post("/v1/events", requireAdmin, async (c) => {
    const parsed = NewEventSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid event", issues: parsed.error.issues }, 400);
    const event = await svc(c).create(parsed.data);
    return c.json(event, 201);
  });

  // ---------- single item (param routes last) ----------
  routes.get("/v1/events/:id", async (c) => {
    const event = await svc(c).get(c.req.param("id"));
    return event ? c.json(event) : c.json({ error: "Not found" }, 404);
  });

  routes.put("/v1/events/:id", requireAdmin, async (c) => {
    const parsed = AdminUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid update", issues: parsed.error.issues }, 400);
    const event = await svc(c).update(c.req.param("id"), parsed.data);
    return event ? c.json(event) : c.json({ error: "Not found" }, 404);
  });

  routes.delete("/v1/events/:id", requireAdmin, async (c) => {
    await svc(c).remove(c.req.param("id"));
    return c.json({ ok: true });
  });

  return routes;
}
