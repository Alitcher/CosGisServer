import { Hono } from "hono";
import { cors } from "hono/cors";

type Bindings = {
  // Optional upstream endpoint; falls back to bundled data when empty/unreachable.
  HEL_WFS_URL?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("/v1/*", cors({ origin: "*" }));

// Bundled fallback so the map never breaks if the city service is down.
const FALLBACK = {
  type: "FeatureCollection",
  features: [
    venue("Messukeskus", "Helsinki", 24.9354, 60.2012),
    venue("Vantaa Energia Areena", "Vantaa", 25.0116, 60.2931),
    venue("Kaapelitehdas", "Helsinki", 24.9043, 60.164),
    venue("Dipoli", "Espoo", 24.827, 60.1849),
  ],
} as const;

function venue(name: string, city: string, lng: number, lat: number) {
  return {
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [lng, lat] as [number, number] },
    properties: { name, city },
  };
}

function isFeatureCollection(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "FeatureCollection" &&
    Array.isArray((data as { features?: unknown }).features)
  );
}

app.get("/", (c) => c.json({ service: "gis-proxy", endpoints: ["/v1/venues", "/health"] }));
app.get("/health", (c) => c.json({ ok: true, service: "gis-proxy" }));

app.get("/v1/venues", async (c) => {
  const cache = caches.default;
  const cacheKey = new Request(c.req.url, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let body: unknown = FALLBACK;
  const url = c.env.HEL_WFS_URL;
  if (url) {
    try {
      const upstream = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
      const data = await upstream.json();
      body = isFeatureCollection(data) ? data : FALLBACK;
    } catch {
      body = FALLBACK;
    }
  }

  const res = c.json(body);
  res.headers.set("Cache-Control", "public, max-age=3600");
  c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
});

export default app;
