# server/places-service/ — Cosplay places API (Worker + D1)

Owns **cosplay-friendly places** — cafés, restaurants, malls, studios and outdoor
spots that welcome cosplayers. Each place carries **photos** and **themes** so
cosplayers can find a spot and shoot themed photos. Persistent locations (unlike
the dated cons in `events-service`), so it's a separate service.

## Endpoints
| Method   | Path                          | Access        | Purpose                          |
|----------|-------------------------------|---------------|----------------------------------|
| `GET`    | `/v1/places`                  | public (CORS) | List live places (GeoJSON-ready) |
| `GET`    | `/v1/places/:id`              | public        | One place                        |
| `POST`   | `/v1/places`                  | **admin**     | Create place                     |
| `PUT`    | `/v1/places/:id`              | **admin**     | Update place                     |
| `DELETE` | `/v1/places/:id`              | **admin**     | Delete place                     |
| `GET`    | `/v1/submissions`             | **admin**     | Pending community submissions    |
| `POST`   | `/v1/submissions`             | public        | Suggest a place (rate-limited)   |
| `POST`   | `/v1/submissions/:id/approve` | **admin**     | Approve → becomes a place        |

`GET /v1/places` returns features the map can consume directly (via
`placesToFeatureCollection` from `@anime-con/shared`).

## Data contract
Schemas live in `@anime-con/shared` (`PlaceSchema`, `NewPlaceSchema`,
`UpdatePlaceSchema`, `PlaceSubmissionSchema`, `PhotoSchema`). Place types:
`cafe | restaurant | mall | studio | outdoor`.

## Storage — D1 (SQLite)
```sql
CREATE TABLE places (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL,        -- cafe | restaurant | mall | studio | outdoor
  city          TEXT NOT NULL,
  address       TEXT,
  lng           REAL NOT NULL,
  lat           REAL NOT NULL,
  themes        TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  photos        TEXT NOT NULL DEFAULT '[]',  -- JSON array of { url, caption? }
  description   TEXT,
  opening_hours TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```
> **Photos are URLs only** for now (`{ url, caption? }`) — stored as a JSON column.
> Real upload/hosting (Cloudflare R2/Images) is a later step.

## Things to get right (learning checkpoints)
- [ ] Parse `themes`/`photos` JSON columns ↔ arrays at the boundary
- [ ] Zod validation on every write (`@anime-con/shared`)
- [ ] CORS on public GET routes
- [ ] Rate limiting on public POST (`/submissions`)
- [ ] D1 migrations checked into git
- [ ] Bounding-box query support (`?bbox=minLng,minLat,maxLng,maxLat`)

## Run
```bash
pnpm install
npx wrangler d1 create cosplay-places-db        # one-time
npx wrangler d1 migrations apply cosplay-places-db --local
npx wrangler dev
```
