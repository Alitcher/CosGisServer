-- Consolidated schema for the merged API service.
-- Before the merge this was spread across the two services: events-service had
-- four migrations (init + linkedevents sync + webauthn) and places-service had
-- its own init. They now share one database and one migrations directory.

-- ---------- Events: dated anime conventions ----------
CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  venue        TEXT NOT NULL,
  city         TEXT NOT NULL,
  date         TEXT NOT NULL,            -- ISO 'YYYY-MM-DD'
  lng          REAL NOT NULL,
  lat          REAL NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'draft',   -- live | draft | pending
  submitted_by TEXT,                     -- set for community submissions
  source       TEXT,                     -- import provenance, e.g. 'linkedevents'
  source_id    TEXT,                     -- upstream id within that source
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_city ON events(city);
-- One row per upstream event: a second import of the same id is ignored.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_source
  ON events(source, source_id) WHERE source IS NOT NULL;

-- ---------- Places: cosplay-friendly cafés, restaurants, malls, studios, outdoor ----------
CREATE TABLE IF NOT EXISTS places (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL,           -- cafe | restaurant | mall | studio | outdoor
  city          TEXT NOT NULL,
  address       TEXT,
  lng           REAL NOT NULL,
  lat           REAL NOT NULL,
  themes        TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  photos        TEXT NOT NULL DEFAULT '[]',   -- JSON array of { url, caption? }
  description   TEXT,
  opening_hours TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',
  submitted_by  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_places_status ON places(status);
CREATE INDEX IF NOT EXISTS idx_places_type ON places(type);
CREATE INDEX IF NOT EXISTS idx_places_city ON places(city);

-- ---------- Import bookkeeping (Helsinki Linked Events) ----------
CREATE TABLE IF NOT EXISTS sync_state (
  key           TEXT PRIMARY KEY,   -- e.g. 'linkedevents'
  last_run      TEXT,               -- ISO time we last completed a sync
  last_modified TEXT                -- max upstream last_modified_time seen (incremental cursor)
);

-- ---------- Admin passkey (WebAuthn) auth ----------
CREATE TABLE IF NOT EXISTS admin_credentials (
  id          TEXT PRIMARY KEY,              -- credential ID (base64url)
  public_key  TEXT NOT NULL,                 -- credential public key bytes, hex-encoded
  counter     INTEGER NOT NULL DEFAULT 0,    -- signature counter (replay protection)
  transports  TEXT,                          -- JSON array of transports, e.g. ["internal"]
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Single-row scratch space for the in-flight WebAuthn challenge (register or login).
CREATE TABLE IF NOT EXISTS admin_challenge (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  challenge  TEXT NOT NULL,
  purpose    TEXT NOT NULL,                  -- 'register' | 'login'
  expires    INTEGER NOT NULL                -- epoch milliseconds
);
