-- Passkey (WebAuthn) credentials for admin login via Windows Hello / a device PIN.
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
