import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../types";
import { verifySession } from "../auth/session";

/**
 * Admin gate shared by every write route (events, places, submissions, sync).
 * Before the merge this exact middleware was copy-pasted into both services;
 * now it lives once.
 *
 * A request is admin if it carries EITHER the static ADMIN_TOKEN (bootstrap /
 * scripts) OR a valid passkey session token. CORS governs browsers only - this
 * token check is what actually secures the API against curl/scripts.
 */

/** Secret used to sign/verify passkey session tokens; reuses ADMIN_TOKEN if unset. */
export const sessionSecret = (env: Bindings) => env.SESSION_SECRET || env.ADMIN_TOKEN;

export const requireAdmin: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const token = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const okStatic = !!c.env.ADMIN_TOKEN && token === c.env.ADMIN_TOKEN;
  const okSession = !!token && (await verifySession(sessionSecret(c.env), token));
  if (!okStatic && !okSession) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
};
