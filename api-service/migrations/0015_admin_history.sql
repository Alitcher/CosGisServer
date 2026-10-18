-- Admin history: every admin change to events / places, so it can be undone, redone
-- or rolled back to a point (Admin > History). One row per changed record; rows of one
-- admin action (e.g. "Combine 3 events") share a group_id.
--   before / after: the full DB row as JSON (NULL before = created, NULL after = deleted)
--   undone: 1 while the action is undone (redo sets it back to 0)
CREATE TABLE IF NOT EXISTS admin_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id   TEXT NOT NULL,
  at         TEXT NOT NULL DEFAULT (datetime('now')),
  actor      TEXT NOT NULL,            -- "passkey 1a2b3c4d" or "admin token"
  label      TEXT NOT NULL,            -- e.g. "Edit event: Kotae Expo"
  tbl        TEXT NOT NULL,            -- events | places
  row_id     TEXT NOT NULL,
  before     TEXT,
  after      TEXT,
  undone     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_admin_history_group ON admin_history (group_id);
CREATE INDEX IF NOT EXISTS idx_admin_history_row ON admin_history (tbl, row_id);
