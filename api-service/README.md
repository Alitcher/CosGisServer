# server/api-service/ — Events + Places API (Worker + D1)

The core microservice. Owns **both** entities the map shows:

- **Events** — dated anime conventions.
- **Places** — persistent cosplay-friendly cafés, restaurants, malls, studios and
  outdoor spots (with photos + themes).

They were originally two separate Workers (`events-service`, `places-service`).
A code review pointed out they share a *lot* of logic — the same admin gate, the
same CORS policy, the same session-token code (which was literally duplicated),
and the same submit → approve workflow. So they're merged into one Worker backed
by **one D1 database**. `gis-proxy` stays separate — it's a stateless cache with a
different failure mode.

## Layered structure

Per the review, code is organized by **layer**, not by entity:

```
src/
  controllers/   HTTP: parse + validate (Zod), shape responses    (events, places, admin)
  services/      business rules: status/submission/approval logic (events, places, linkedevents)
  repositories/  data access: SQL, one interface per entity       (events, places)
  auth/          session tokens (HMAC) + WebAuthn passkeys         — shared ONCE, not duplicated
  middleware/    requireAdmin + CORS
  index.ts       one app: mounts the controllers, CORS, cron
```

A request flows **controller → service → repository**. Swapping D1 for Postgres
later means writing one new repository implementation — controllers and services
don't change.

## Endpoints

### Events
| Method   | Path                                   | Access        | Purpose                       |
|----------|----------------------------------------|---------------|-------------------------------|
| `GET`    | `/v1/events`                           | public (CORS) | List live events (`?city=`)   |
| `GET`    | `/v1/events.geojson`                   | public        | Live events as GeoJSON        |
| `GET`    | `/v1/events/:id`                       | public        | One event                     |
| `POST`   | `/v1/events`                           | **admin**     | Create event                  |
| `PUT`    | `/v1/events/:id`                       | **admin**     | Update event                  |
| `DELETE` | `/v1/events/:id`                       | **admin**     | Delete event                  |
| `POST`   | `/v1/events/submissions`               | public        | Submit a con (pending queue)  |
| `GET`    | `/v1/events/submissions`               | **admin**     | Pending submissions           |
| `POST`   | `/v1/events/submissions/:id/approve`   | **admin**     | Approve → becomes live        |
| `POST`   | `/v1/events/sync/linkedevents`         | **admin**     | Import Helsinki Linked Events |

### Places
| Method   | Path                                   | Access        | Purpose                       |
|----------|----------------------------------------|---------------|-------------------------------|
| `GET`    | `/v1/places`                           | public (CORS) | List live places (`?type=`,`?city=`) |
| `GET`    | `/v1/places.geojson`                   | public        | Live places as GeoJSON        |
| `GET`    | `/v1/places/:id`                       | public        | One place                     |
| `POST`   | `/v1/places`                           | **admin**     | Create place                  |
| `PUT`    | `/v1/places/:id`                       | **admin**     | Update place                  |
| `DELETE` | `/v1/places/:id`                       | **admin**     | Delete place                  |
| `POST`   | `/v1/places/submissions`               | public        | Suggest a place (pending)     |
| `GET`    | `/v1/places/submissions`               | **admin**     | Pending submissions           |
| `POST`   | `/v1/places/submissions/:id/approve`   | **admin**     | Approve → becomes live        |

### Admin (passkey / WebAuthn)
`GET /v1/admin/status`, `POST /v1/admin/register/options|verify`,
`POST /v1/admin/login/options|verify`. Login mints a short-lived session token
accepted by every `admin` route above.

> **⚠️ Route change vs. the old services:** submissions moved from the flat
> `/v1/submissions` to `/v1/events/submissions` and `/v1/places/submissions` so the
> two can share one Worker without colliding. The public read routes
> (`/v1/events`, `/v1/places`, `.geojson`, `/:id`) are unchanged. The frontend now
> points **one** base URL at this service instead of two.

## Storage — D1 (SQLite)
One database, one `migrations/` directory:
`0001_init.sql` (events + places + `sync_state` + WebAuthn tables) and
`0002_seed.sql` (sample events + places). Photos are URL-only JSON for now;
`themes`/`photos` are parsed ↔ arrays inside the places repository.

> D1 has no PostGIS, so "spots within N km of me" is a bounding-box `WHERE` for
> now. A Postgres implementation of the repositories would unlock real radius
> queries — noted as a future upgrade, not required at this scale.

## Auth (write endpoints)
Static `ADMIN_TOKEN` (bootstrap/scripts) **or** a passkey session token. Secrets
via `.dev.vars` locally / `wrangler secret put` in production. Never commit them.

## Run
```bash
pnpm install
pnpm db:create                      # one-time; paste the id into wrangler.toml
pnpm db:migrate                     # apply 0001 + 0002 locally
pnpm dev                            # http://localhost:8787
```
