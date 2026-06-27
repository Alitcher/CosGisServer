# server/gis-proxy/ — Venue geometry proxy (Worker)

A thin, **stateless** Worker that fetches venue geometry from the City of
Helsinki open GIS service, fixes CORS, and caches the result. No database.

## Why it exists
- The browser **can't** call `hel.kartta.fi` directly — CORS blocks it.
- We don't want to hammer the city's servers — so we **cache** responses.
- It's a different concern from the events data, so it's its own service.

## Endpoints
| Method | Path            | Purpose                                        |
|--------|-----------------|------------------------------------------------|
| `GET`  | `/v1/venues`    | Venue geometry as GeoJSON (CORS on, cached)    |
| `GET`  | `/health`       | Liveness check                                 |

## How it works
1. Fetch the WFS/REST endpoint from `hel.kartta.fi`.
2. Normalize to clean GeoJSON `FeatureCollection`.
3. Cache with the Workers **Cache API** (or KV) — e.g. revalidate hourly.
4. On upstream failure → return a small bundled **fallback** GeoJSON so the map
   never breaks (mirrors the fallback already in `projectplan.md`).

## Things to get right
- [ ] CORS headers
- [ ] Edge caching + TTL
- [ ] Graceful fallback when upstream is down
- [ ] Timeout on the upstream fetch

## Run
```bash
npm install
npx wrangler dev
```
