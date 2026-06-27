# server/events-service/ — Events API (Worker + D1)

The core microservice. Owns the events data, serves the public read API, and
handles admin create/edit/delete plus the community-submission queue.

## Endpoints
| Method   | Path                       | Access          | Purpose                          |
|----------|----------------------------|-----------------|----------------------------------|
| `GET`    | `/v1/events`               | public (CORS)   | List live events (anyone)        |
| `GET`    | `/v1/events/:id`           | public          | One event                        |
| `POST`   | `/v1/events`               | **admin**       | Create event                     |
| `PUT`    | `/v1/events/:id`           | **admin**       | Update event                     |
| `DELETE` | `/v1/events/:id`           | **admin**       | Delete event                     |
| `GET`    | `/v1/submissions`          | **admin**       | Pending community submissions    |
| `POST`   | `/v1/submissions`          | public          | Submit a con (rate-limited)      |
| `POST`   | `/v1/submissions/:id/approve` | **admin**    | Approve → becomes an event       |

`GET /v1/events` returns GeoJSON-friendly data the map can consume directly.

## Storage — D1 (SQLite)
Schema managed with **migrations** (`wrangler d1 migrations`):
```sql
CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  venue       TEXT NOT NULL,
  city        TEXT NOT NULL,
  date        TEXT NOT NULL,        -- ISO 'YYYY-MM-DD'
  lng         REAL NOT NULL,
  lat         REAL NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'draft',  -- live | draft | pending
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Auth (write endpoints)
Start simple (admin API key header) → upgrade to JWT login for the admin page.
Secrets via `wrangler secret put ADMIN_TOKEN`. Never commit them.

## Things to get right (learning checkpoints)
- [ ] Parameterized queries (no SQL injection)
- [ ] Zod validation on every write
- [ ] CORS on the public GET routes
- [ ] Rate limiting on public POST (`/submissions`)
- [ ] D1 migrations checked into git
- [ ] `wrangler d1 export` backups

## Run
```bash
npm install
npx wrangler d1 create anime-cons-db        # one-time
npx wrangler d1 migrations apply anime-cons-db --local
npx wrangler dev
```
