# 🎌 Cosplay Map — Server

Backend for the **Helsinki / Vantaa cosplay map**. A small pnpm monorepo of
independently deployable **Cloudflare Workers** microservices. The frontend lives
in a **separate repo** (`cosplay-map-client`) and talks to these services over HTTP.

## Services
| Folder            | Job                                                  | State        |
|-------------------|------------------------------------------------------|--------------|
| `shared/`         | Shared TS types + Zod schemas (Event + Place)        | none (lib)   |
| `events-service/` | Anime conventions: CRUD + public read API + queue    | D1 (SQLite)  |
| `places-service/` | Cosplay-friendly places (photos + themes): CRUD + API| D1 (SQLite)  |
| `gis-proxy/`      | Proxy + cache venue geometry from hel.kartta.fi      | none         |

`shared/` is an **internal** workspace package (`@anime-con/shared`) used only by
these services to validate writes. The client keeps its own lightweight types
(it's a read-only consumer of the public APIs), so the contract is **not**
published — this repo is the source of truth for it.

## Stack
Cloudflare Workers · D1 (SQLite) · Hono · Wrangler · TypeScript · Zod 4

## Run
```bash
pnpm install
pnpm -r typecheck

# each service runs on its own port
cd events-service && npx wrangler dev    # → http://localhost:8787
cd places-service && npx wrangler dev    # → http://localhost:8788
cd gis-proxy     && npx wrangler dev     # → http://localhost:8789
```

## Layout
```
cosplay-map-server/
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── shared/            @anime-con/shared — Event + Place Zod contract
├── events-service/    Worker + D1
├── places-service/    Worker + D1
└── gis-proxy/         Worker (cache only)
```

> ⚠️ D1 is SQLite (no PostGIS) — geometry is plain `lng`/`lat` columns, queried
> with bounding boxes.

## Status
- [x] `shared/` contract (Event + Place schemas, types, GeoJSON helpers)
- [ ] `events-service` Worker + D1
- [ ] `places-service` Worker + D1
- [ ] `gis-proxy` Worker
- [ ] Deploy to Cloudflare
