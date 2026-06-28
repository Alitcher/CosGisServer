-- Events: dated anime conventions.
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
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_city ON events(city);
