import { Hono, type Context } from "hono";
import {
  NewPlaceSchema,
  UpdatePlaceSchema,
  PlaceSubmissionSchema,
  StatusEnum,
  PurposeEnum,
  placesToFeatureCollection,
} from "@anime-con/shared";
import type { Bindings } from "../types";
import { requireAdmin } from "../middleware/auth";
import { submissionQuota } from "../middleware/rate-limit";
import { d1PlacesRepo } from "../repositories/places.repo";
import { contentDb } from "../repositories/mirror";
import { translateInBackground } from "../services/translate";
import { placesService } from "../services/places.service";
import { findDuplicatePlace, duplicateBody } from "../services/duplicates";

const AdminUpdateSchema = UpdatePlaceSchema.extend({ status: StatusEnum.optional() });

/**
 * HTTP layer for places - mirrors the events controller. Submissions live at
 * `/v1/places/submissions` (namespaced so they don't collide with events'
 * submissions now that both share one Worker).
 */
export function placesController() {
  const routes = new Hono<{ Bindings: Bindings }>();
  const svc = (c: Context<{ Bindings: Bindings }>) => placesService(d1PlacesRepo(contentDb(c)));
  // After a save: fill in the other languages in the background (services/translate.ts).
  const translate = (c: Context<{ Bindings: Bindings }>, item: Parameters<typeof translateInBackground>[2], refresh = false) =>
    translateInBackground(c, d1PlacesRepo(contentDb(c)), item, refresh);

  // ---------- public reads ----------
  routes.get("/v1/places.geojson", async (c) => {
    return c.json(placesToFeatureCollection(await svc(c).listLive()));
  });

  // ---------- community submissions (static, before /:id) ----------
  routes.post("/v1/places/submissions", submissionQuota, async (c) => {
    const parsed = PlaceSubmissionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid submission", issues: parsed.error.issues }, 400);
    // Same address, within 50 m, same name, link or photo as anything stored = duplicate.
    const dup = findDuplicatePlace(await d1PlacesRepo(contentDb(c)).list(), parsed.data);
    if (dup) return c.json(duplicateBody("spot", dup), 409);
    const place = await svc(c).submit(parsed.data);
    translate(c, place);
    return c.json({ ok: true, id: place.id }, 201);
  });

  routes.get("/v1/places/submissions", requireAdmin, async (c) => {
    return c.json(await svc(c).listPending());
  });

  routes.post("/v1/places/submissions/:id/approve", requireAdmin, async (c) => {
    const place = await svc(c).approve(c.req.param("id"));
    return place ? c.json(place) : c.json({ error: "Not found" }, 404);
  });

  // ---------- list + create ----------
  // `?purpose=photo|practice` narrows to the Spots or Practice tab's places.
  routes.get("/v1/places", async (c) => {
    const rawPurpose = c.req.query("purpose");
    const purpose = rawPurpose ? PurposeEnum.safeParse(rawPurpose) : null;
    if (purpose && !purpose.success) return c.json({ error: "purpose must be 'photo' or 'practice'" }, 400);
    return c.json(
      await svc(c).listLive({
        type: c.req.query("type") || undefined,
        city: c.req.query("city") || undefined,
        country: c.req.query("country") || undefined,
        purpose: purpose?.data,
      }),
    );
  });

  routes.post("/v1/places", requireAdmin, async (c) => {
    const parsed = NewPlaceSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid place", issues: parsed.error.issues }, 400);
    const place = await svc(c).create(parsed.data);
    translate(c, place);
    return c.json(place, 201);
  });

  // ---------- single item (param routes last) ----------
  routes.get("/v1/places/:id", async (c) => {
    const place = await svc(c).get(c.req.param("id"));
    return place ? c.json(place) : c.json({ error: "Not found" }, 404);
  });

  routes.put("/v1/places/:id", requireAdmin, async (c) => {
    const parsed = AdminUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid update", issues: parsed.error.issues }, 400);
    const before = await svc(c).get(c.req.param("id"));
    const place = await svc(c).update(c.req.param("id"), parsed.data);
    // Original text changed: redo the auto translations (hand-written ones are kept).
    translate(c, place, !!before && !!place && (before.name !== place.name || before.description !== place.description));
    return place ? c.json(place) : c.json({ error: "Not found" }, 404);
  });

  routes.delete("/v1/places/:id", requireAdmin, async (c) => {
    await svc(c).remove(c.req.param("id"));
    return c.json({ ok: true });
  });

  return routes;
}
