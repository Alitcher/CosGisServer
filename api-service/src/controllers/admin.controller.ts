import { Hono } from "hono";
import type { Bindings } from "../types";
import { requireAdmin, sessionSecret } from "../middleware/auth";
import { signSession } from "../auth/session";
import { listHistory, undoGroup, redoGroup, jumpTo } from "../services/history";
import { adminCount, beginRegistration, finishRegistration, beginLogin, finishLogin } from "../auth/webauthn";
import { d1EventsRepo } from "../repositories/events.repo";
import { d1PlacesRepo } from "../repositories/places.repo";
import { contentDb } from "../repositories/mirror";
import { translateMissing } from "../services/translate";
import { lookupTransit } from "../services/transit";
import { Latitude, Longitude } from "@anime-con/shared";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";

/**
 * Admin passkey (WebAuthn) auth. This used to live only in events-service (the
 * "auth host") while places-service just trusted its tokens. After the merge
 * there is one host and one set of `/v1/admin/*` routes.
 */
export function adminController() {
  const routes = new Hono<{ Bindings: Bindings }>();

  // Does an admin passkey exist yet? Drives register-vs-login in the UI.
  routes.get("/v1/admin/status", async (c) => c.json({ registered: (await adminCount(c.env.DB)) > 0 }));

  // Enrolling a passkey is bootstrap-authorized by the static ADMIN_TOKEN (or an
  // existing session), so only someone holding the secret can register a device.
  routes.post("/v1/admin/register/options", requireAdmin, async (c) => {
    return c.json(await beginRegistration(c.env, c.env.DB));
  });
  routes.post("/v1/admin/register/verify", requireAdmin, async (c) => {
    const body = (await c.req.json().catch(() => null)) as RegistrationResponseJSON | null;
    if (!body) return c.json({ error: "Invalid body" }, 400);
    const ok = await finishRegistration(c.env, c.env.DB, body);
    return ok ? c.json({ verified: true }) : c.json({ error: "Registration failed" }, 400);
  });

  // Login is public: anyone can request a challenge, but only the device holding
  // the private key can complete it. On success we mint a short-lived session token.
  routes.post("/v1/admin/login/options", async (c) => {
    return c.json(await beginLogin(c.env, c.env.DB));
  });
  routes.post("/v1/admin/login/verify", async (c) => {
    const body = (await c.req.json().catch(() => null)) as AuthenticationResponseJSON | null;
    if (!body) return c.json({ error: "Invalid body" }, 400);
    const ok = await finishLogin(c.env, c.env.DB, body);
    if (!ok) return c.json({ error: "Login failed" }, 401);
    // sub: which passkey logged in, so Admin > History can show who made a change.
    return c.json({ token: await signSession(sessionSecret(c.env), undefined, String(body.id ?? "").slice(0, 8) || undefined) });
  });


  // Translate events/places that have no other languages yet (imports, older rows),
  // up to 25 per call. Call again while 'remaining' > 0. The daily cron does the same.
  routes.post("/v1/admin/translate", requireAdmin, async (c) => {
    if (!c.env.AI) return c.json({ error: "Workers AI (AI binding) is not configured" }, 503);
    const events = d1EventsRepo(contentDb(c));
    const places = d1PlacesRepo(contentDb(c));
    return c.json(
      await translateMissing(c.env.AI, [
        { items: await events.list(), repo: events },
        { items: await places.list(), repo: places },
      ]),
    );
  });
  // Nearby metro/train/tram/bus stops for a point (Digitransit in Finland, else OSM). Only returns
  // suggestions: the admin reviews or edits them and saves with the event/place.
  routes.post("/v1/admin/transit/lookup", requireAdmin, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { lat?: unknown; lng?: unknown } | null;
    const lat = Latitude.safeParse(body?.lat);
    const lng = Longitude.safeParse(body?.lng);
    if (!lat.success || !lng.success) return c.json({ error: "lat and lng are required" }, 400);
    try {
      return c.json({ transit: await lookupTransit(lat.data, lng.data, { digitransitKey: c.env.DIGITRANSIT_KEY }) });
    } catch (e) {
      console.error("transit lookup failed", e);
      return c.json({ error: "Transit lookup failed, try again or fill it in by hand" }, 502);
    }
  });
  // ---------- history: undo / redo / jump (services/history.ts) ----------
  routes.get("/v1/admin/history", requireAdmin, async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 500);
    return c.json(await listHistory(contentDb(c), limit));
  });
  routes.post("/v1/admin/history/:group/undo", requireAdmin, async (c) => {
    const r = await undoGroup(contentDb(c), c.req.param("group"));
    return r.ok ? c.json(r) : c.json(r, r.error === "Not found" ? 404 : 409);
  });
  routes.post("/v1/admin/history/:group/redo", requireAdmin, async (c) => {
    const r = await redoGroup(contentDb(c), c.req.param("group"));
    return r.ok ? c.json(r) : c.json(r, r.error === "Not found" ? 404 : 409);
  });
  // Make the data look like right after this action: later ones undone, earlier ones redone.
  routes.post("/v1/admin/history/:group/jump", requireAdmin, async (c) => {
    const r = await jumpTo(contentDb(c), c.req.param("group"));
    return r.ok ? c.json(r) : c.json(r, 404);
  });

  return routes;
}
