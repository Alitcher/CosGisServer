-- Provenance for imported events (e.g. Helsinki Linked Events) so we can dedupe.
ALTER TABLE events ADD COLUMN source    TEXT;   -- e.g. 'linkedevents'
ALTER TABLE events ADD COLUMN source_id TEXT;   -- the upstream event id

-- One row per upstream event: a second import of the same id is ignored.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_source
  ON events(source, source_id) WHERE source IS NOT NULL;

-- Bookkeeping so we don't re-download when our data is already up to date.
CREATE TABLE IF NOT EXISTS sync_state (
  key           TEXT PRIMARY KEY,   -- e.g. 'linkedevents'
  last_run      TEXT,               -- ISO time we last completed a sync
  last_modified TEXT                -- max upstream last_modified_time seen (incremental cursor)
);
