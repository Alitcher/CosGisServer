import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import {
  NewEventSchema,
  UpdateEventSchema,
  EventSubmissionSchema,
  StatusEnum,
  eventsToFeatureCollection,
} from "@anime-con/shared";
import { d1EventsRepo } from "./repo";
import { syncLinkedEvents } from "./linkedevents";
import { signSession, verifySession } from "./session";
import { adminCount, beginRegistration, finishRegistration, beginLogin, finishLogin } from "./webauthn";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";

type Bindings = {
  DB: D1Database;
  ADMIN_TOKEN: string;
  ALLOWED_ORIGINS?: string; // comma-separated site origins; empty = allow any (dev)
  SESSION_SECRET?: string;  // HMAC secret for passkey session tokens; falls back to ADMIN_TOKEN
  RP_ID?: string;           // WebAuthn relying-party id (domain), default "localhost"
  RP_NAME?: string;         // user-visible name, default "CosplayMap Admin"
  RP_ORIGIN?: string;       // expected site origin, default "http://localhost:3000"
};

// Secret used to sign/verify passkey session tokens. Reuses ADMIN_TOKEN if a
// dedicated SESSION_SECRET isn't set, so local dev works with no extra config.
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

// The one place storage is chosen. Swap d1EventsRepo(...) for mongoEventsRepo(...) later.
const repo = (c: Context<{ Bindings: Bindings }>) => d1EventsRepo(c.env.DB);

const requireAdmin: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const token = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const okStatic = !!c.env.ADMIN_TOKEN && token === c.env.ADMIN_TOKEN;
  const okSession = !!token && (await verifySession(sessionSecret(c.env), token));
  if (!okStatic && !okSession) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
};

// Admin updates may also change status (NewEvent omits it).
const AdminUpdateSchema = UpdateEventSchema.extend({ status: StatusEnum.optional() });

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
  return c.json(await repo(c).list({ status: "live", city: city || undefined }));
});

app.get("/v1/events.geojson", async (c) => {
  const events = await repo(c).list({ status: "live" });
  return c.json(eventsToFeatureCollection(events));
});

app.get("/v1/events/:id", async (c) => {
  const event = await repo(c).get(c.req.param("id"));
  return event ? c.json(event) : c.json({ error: "Not found" }, 404);
});

// ---------- admin writes ----------
app.post("/v1/events", requireAdmin, async (c) => {
  const parsed = NewEventSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid event", issues: parsed.error.issues }, 400);
  const event = await repo(c).create({ ...parsed.data, status: "live" });
  return c.json(event, 201);
});

app.put("/v1/events/:id", requireAdmin, async (c) => {
  const parsed = AdminUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid update", issues: parsed.error.issues }, 400);
  const event = await repo(c).update(c.req.param("id"), parsed.data);
  return event ? c.json(event) : c.json({ error: "Not found" }, 404);
});

app.delete("/v1/events/:id", requireAdmin, async (c) => {
  await repo(c).remove(c.req.param("id"));
  return c.json({ ok: true });
});

// ---------- community submissions ----------
app.post("/v1/submissions", async (c) => {
  const parsed = EventSubmissionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid submission", issues: parsed.error.issues }, 400);
  const { submittedBy, ...rest } = parsed.data;
  const event = await repo(c).create({ ...rest, status: "pending", submittedBy });
  return c.json({ ok: true, id: event.id }, 201);
});

app.get("/v1/submissions", requireAdmin, async (c) => {
  return c.json(await repo(c).list({ status: "pending" }));
});

app.post("/v1/submissions/:id/approve", requireAdmin, async (c) => {
  const event = await repo(c).update(c.req.param("id"), { status: "live" });
  return event ? c.json(event) : c.json({ error: "Not found" }, 404);
});

// ---------- Helsinki Linked Events import ----------
// Pulls cosplay/manga events into the pending queue. `?force=1` bypasses the
// 12h freshness guard. Imported events still need admin approval to go live.
app.post("/v1/sync/linkedevents", requireAdmin, async (c) => {
  const force = ["1", "true"].includes((c.req.query("force") ?? "").toLowerCase());
  const result = await syncLinkedEvents(repo(c), c.env.DB, { force });
  return c.json(result);
});

// ---------- admin passkey (WebAuthn) auth ----------
// status: does an admin passkey exist yet? (drives register-vs-login in the UI)
app.get("/v1/admin/status", async (c) => c.json({ registered: (await adminCount(c.env.DB)) > 0 }));

// Enrolling a passkey is bootstrap-authorized by the static ADMIN_TOKEN (or an
// existing session), so only someone holding the secret can register a device.
app.post("/v1/admin/register/options", requireAdmin, async (c) => {
  return c.json(await beginRegistration(c.env, c.env.DB));
});
app.post("/v1/admin/register/verify", requireAdmin, async (c) => {
  const body = (await c.req.json().catch(() => null)) as RegistrationResponseJSON | null;
  if (!body) return c.json({ error: "Invalid body" }, 400);
  const ok = await finishRegistration(c.env, c.env.DB, body);
  return ok ? c.json({ verified: true }) : c.json({ error: "Registration failed" }, 400);
});

// Login is public: anyone can request a challenge, but only the device holding the
// private key can complete it. On success we mint a short-lived session token.
app.post("/v1/admin/login/options", async (c) => {
  return c.json(await beginLogin(c.env, c.env.DB));
});
app.post("/v1/admin/login/verify", async (c) => {
  const body = (await c.req.json().catch(() => null)) as AuthenticationResponseJSON | null;
  if (!body) return c.json({ error: "Invalid body" }, 400);
  const ok = await finishLogin(c.env, c.env.DB, body);
  if (!ok) return c.json({ error: "Login failed" }, 401);
  return c.json({ token: await signSession(sessionSecret(c.env)) });
});

export default {
  fetch: app.fetch,
  // Cron Trigger (see wrangler.toml). Runs the sync automatically; the freshness
  // guard inside still prevents redundant downloads.
  async scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(syncLinkedEvents(d1EventsRepo(env.DB), env.DB).then(() => undefined));
  },
};
