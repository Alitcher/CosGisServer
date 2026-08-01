# 🎌 Cosplay Map — Server

Backend for the **Helsinki / Vantaa cosplay map**. A small pnpm monorepo of
independently deployable **Cloudflare Workers** microservices. The frontend lives
in a **separate repo** (`cosplay-map-client`) and talks to these services over HTTP.

## Services
| Folder          | Job                                                          | State        |
|-----------------|--------------------------------------------------------------|--------------|
| `shared/`       | Shared TS types + Zod schemas (Event + Place)                | none (lib)   |
| `api-service/`  | Events **and** places: CRUD + public read + submissions + admin auth | D1 (SQLite)  |
| `gis-proxy/`    | Proxy + cache venue geometry from hel.kartta.fi              | none         |

> **Merged:** events and places were two Workers (`events-service`,
> `places-service`) that duplicated the admin gate, CORS, and session-token code.
> Following a code review they're now one `api-service` (layered
> controllers → services → repositories) sharing a single D1 database. `gis-proxy`
> stays separate — it's a stateless cache with its own failure mode.

`shared/` is an **internal** workspace package (`@anime-con/shared`) used only by
these services to validate writes. The client keeps its own lightweight types
(it's a read-only consumer of the public APIs), so the contract is **not**
published — this repo is the source of truth for it.

## Stack
Cloudflare Workers · D1 (SQLite) · Hono · Wrangler · TypeScript · Zod 4

## Run

```bash
pnpm install

# one-time: create + seed the local D1 database
cp api-service/.dev.vars.example api-service/.dev.vars
pnpm migrate

# start both Workers at once (Ctrl+C stops them all)
pnpm dev
```

This boots:
- api-service → http://localhost:8787   (events + places + admin)
- gis-proxy   → http://localhost:8789

To run a single service instead: `cd <service> && pnpm dev`.

## Layout
```
cosplay-map-server/
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── shared/          @anime-con/shared — Event + Place Zod contract
├── api-service/     Worker + D1 (events + places + admin auth)
└── gis-proxy/       Worker (cache only)
```

> ⚠️ D1 is SQLite (no PostGIS) — geometry is plain `lng`/`lat` columns, queried
> with bounding boxes.

## Status
- [x] `shared/` contract (Event + Place schemas, types, GeoJSON helpers)
- [x] `api-service` Worker + D1 (events + places CRUD + public read + submissions + admin auth)
- [x] `gis-proxy` Worker (cache + fallback)
- [ ] Deploy to Cloudflare
