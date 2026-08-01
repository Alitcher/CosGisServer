-- Daily quota for public (non-admin) submissions.
--
-- One row per (bucket, day). A "bucket" is whoever we are counting: a device id
-- sent by the client ("dev:<uuid>") or the caller's IP ("ip:<addr>"). Rows are
-- disposable - the daily cron deletes everything older than today.

CREATE TABLE IF NOT EXISTS submission_quota (
  bucket TEXT NOT NULL,               -- 'dev:<id>' | 'ip:<addr>'
  day    TEXT NOT NULL,               -- local calendar day 'YYYY-MM-DD' (Europe/Helsinki)
  count  INTEGER NOT NULL DEFAULT 0,  -- submissions accepted from this bucket that day
  PRIMARY KEY (bucket, day)
);

-- Supports the cron's "delete every day before today" sweep.
CREATE INDEX IF NOT EXISTS idx_submission_quota_day ON submission_quota(day);
