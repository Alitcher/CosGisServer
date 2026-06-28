-- Places: cosplay-friendly cafés, restaurants, malls, studios, outdoor spots.
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
