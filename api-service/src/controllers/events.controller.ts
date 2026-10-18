import { Hono, type Context } from "hono";
import {
  NewEventSchema,
  UpdateEventSchema,
  EventSubmissionSchema,
  StatusEnum,
  ageRangeOk,
  eventsToFeatureCollection,
} from "@anime-con/shared";
import type { Bindings } from "../types";
import { requireAdmin } from "../middleware/auth";
import { submissionQuota } from "../middleware/rate-limit";
import { d1EventsRepo } from "../repositories/events.repo";
import { contentDb } from "../repositories/mirror";
import { translateInBackground } from "../services/translate";
import { eventsService } from "../services/events.service";
import { findDuplicateEvent, duplicateBody } from "../services/duplicates";
import { syncLinkedEvents, ESPOO } from "../services/linkedevents";
import { syncConit } from "../services/conit";
import { syncOuluComics } from "../services/oulucomics";
import { recorded } from "../services/history";

// Admin updates may also change status (NewEvent omits it).
const AdminUpdateSchema = UpdateEventSchema.extend({ status: StatusEnum.optional() });

/** A price range must not run backwards ("from 25 to 10"). */
const priceRangeOk = (e: { priceMin?: number; priceMax?: number }) =>
  e.priceMin == null || e.priceMax == null || e.priceMax >= e.priceMin;
const BAD_PRICE = { error: "priceMax can't be lower than priceMin" } as const;
const BAD_AGE = { error: "ageMax can't be lower than ageMin" } as const;

/** `?force=1` on a sync route bypasses the importer's freshness guard. */
const forced = (c: Context<{ Bindings: Bindings }>) =>
  ["1", "true"].includes((c.req.query("force") ?? "").toLowerCase());

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
  const svc = (c: Context<{ Bindings: Bindings }>) => eventsService(d1EventsRepo(contentDb(c)));
  // After a save: fill in the other languages in the background (services/translate.ts).
  const translate = (c: Context<{ Bindings: Bindings }>, item: Parameters<typeof translateInBackground>[2], refresh = false) =>
    translateInBackground(c, d1EventsRepo(contentDb(c)), item, refresh);
  // Admin writes go into Admin > History (services/history.ts) so they can be undone.
  const name = (row: Record<string, unknown> | null) => String(row?.name ?? "");

  // ---------- public reads ----------
  routes.get("/v1/events.geojson", async (c) => {
    return c.json(eventsToFeatureCollection(await svc(c).listLive()));
  });

  // ---------- community submissions (static, before /:id) ----------
  routes.post("/v1/events/submissions", submissionQuota, async (c) => {
    const parsed = EventSubmissionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid submission", issues: parsed.error.issues }, 400);
    if (!priceRangeOk(parsed.data)) return c.json(BAD_PRICE, 400);
    if (!ageRangeOk(parsed.data)) return c.json(BAD_AGE, 400);
    // Same link on the same date as anything stored (live, pending or draft) = duplicate.
    const dup = findDuplicateEvent(await d1EventsRepo(contentDb(c)).list(), parsed.data);
    if (dup) return c.json(duplicateBody("event", dup), 409);
    const event = await svc(c).submit(parsed.data);
    translate(c, event);
    return c.json({ ok: true, id: event.id }, 201);
  });

  routes.get("/v1/events/submissions", requireAdmin, async (c) => {
    return c.json(await svc(c).listPending());
  });

  routes.post("/v1/events/submissions/:id/approve", requireAdmin, async (c) => {
    const id = c.req.param("id");
    const event = await recorded(c, contentDb(c), "events", (r) => `Approve event: ${name(r)}`, [id], () => svc(c).approve(id));
    return event ? c.json(event) : c.json({ error: "Not found" }, 404);
  });

  // ---------- imports ----------
  // `?force=1` bypasses the 12h freshness guard. Imports land as pending.
  // One route per feed: Linked Events covers the capital region in depth (Helsinki
  // + Espoo), conit.fi covers Finnish conventions nationwide, Oulu Comics Center
  // covers Oulu.
  routes.post("/v1/events/sync/linkedevents", requireAdmin, async (c) => {
    const result = await syncLinkedEvents(d1EventsRepo(c.env.DB), c.env.DB, { force: forced(c) });
    return c.json(result);
  });

  routes.post("/v1/events/sync/linkedevents-espoo", requireAdmin, async (c) => {
    const result = await syncLinkedEvents(d1EventsRepo(c.env.DB), c.env.DB, { force: forced(c) }, ESPOO);
    return c.json(result);
  });

  routes.post("/v1/events/sync/conit", requireAdmin, async (c) => {
    const result = await syncConit(d1EventsRepo(c.env.DB), c.env.DB, { force: forced(c) });
    return c.json(result);
  });

  routes.post("/v1/events/sync/oulucomics", requireAdmin, async (c) => {
    const result = await syncOuluComics(d1EventsRepo(c.env.DB), c.env.DB, { force: forced(c) });
    return c.json(result);
  });

  // ---------- list + create ----------
  routes.get("/v1/events", async (c) => {
    return c.json(
      await svc(c).listLive({
        city: c.req.query("city") || undefined,
        country: c.req.query("country") || undefined,
      }),
    );
  });

  routes.post("/v1/events", requireAdmin, async (c) => {
    const parsed = NewEventSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid event", issues: parsed.error.issues }, 400);
    if (!priceRangeOk(parsed.data)) return c.json(BAD_PRICE, 400);
    if (!ageRangeOk(parsed.data)) return c.json(BAD_AGE, 400);
    const event = await recorded(c, contentDb(c), "events", (r) => `Add event: ${name(r)}`, [], () => svc(c).create(parsed.data), (e) => e.id);
    translate(c, event);
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
    if (!priceRangeOk(parsed.data)) return c.json(BAD_PRICE, 400);
    if (!ageRangeOk(parsed.data)) return c.json(BAD_AGE, 400);
    const id = c.req.param("id");
    const before = await svc(c).get(id);
    const event = await recorded(c, contentDb(c), "events", (r) => `Edit event: ${name(r)}`, [id], () => svc(c).update(id, parsed.data));
    // Original text changed: redo the auto translations (hand-written ones are kept).
    translate(c, event, !!before && !!event && (before.name !== event.name || before.description !== event.description));
    return event ? c.json(event) : c.json({ error: "Not found" }, 404);
  });

  routes.delete("/v1/events/:id", requireAdmin, async (c) => {
    const id = c.req.param("id");
    await recorded(c, contentDb(c), "events", (r) => `Delete event: ${name(r)}`, [id], () => svc(c).remove(id));
    return c.json({ ok: true });
  });

  return routes;
}
