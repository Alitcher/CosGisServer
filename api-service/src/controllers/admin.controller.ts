import { Hono } from "hono";
import type { Bindings } from "../types";
import { requireAdmin, sessionSecret } from "../middleware/auth";
import { signSession } from "../auth/session";
import { adminCount, beginRegistration, finishRegistration, beginLogin, finishLogin } from "../auth/webauthn";
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
    return c.json({ token: await signSession(sessionSecret(c.env)) });
  });

  return routes;
}
