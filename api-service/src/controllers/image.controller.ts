import { Hono } from "hono";
import type { Bindings } from "../types";

const MAX_BYTES = 6 * 1024 * 1024; // event posters are small; anything bigger is refused

/**
 * Image relay for the client's "Share as picture" (canvas). Event pictures live on other
 * sites that don't send CORS headers, so a browser may show them but not draw them into a
 * PNG. `GET /v1/img?url=...` fetches the picture and returns it with CORS allowed.
 *
 * Not an open proxy: only URLs that are the picture of a stored event (`image`) or place
 * (`photos`) are relayed, and only image responses up to MAX_BYTES.
 */
export function imageController() {
  const routes = new Hono<{ Bindings: Bindings }>();

  routes.get("/v1/img", async (c) => {
    const url = c.req.query("url") ?? "";
    if (!/^https?:\/\//i.test(url) || url.length > 500) return c.json({ error: "Bad url" }, 400);
    const known =
      (await c.env.DB.prepare("SELECT 1 FROM events WHERE image = ? LIMIT 1").bind(url).first()) ??
      (await c.env.DB.prepare("SELECT 1 FROM places WHERE photos LIKE ? LIMIT 1").bind(`%${JSON.stringify(url).slice(1, -1)}%`).first());
    if (!known) return c.json({ error: "Not an event or place picture" }, 404);

    const res = await fetch(url, { headers: { Accept: "image/*" }, cf: { cacheTtl: 86400, cacheEverything: true } });
    const type = res.headers.get("Content-Type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return c.json({ error: "Picture not available" }, 502);
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return c.json({ error: "Picture too big" }, 413);
    return new Response(body, {
      headers: {
        "Content-Type": type,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  return routes;
}
