CREATE TABLE IF NOT EXISTS licenses (
  code_hash TEXT PRIMARY KEY,
  license_id TEXT NOT NULL UNIQUE,
  buyer_email TEXT NOT NULL,
  order_ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  installation_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  activated_at INTEGER,
  checked_at INTEGER
);

CREATE INDEX IF NOT EXISTS licenses_installation_id ON licenses (installation_id);
CREATE INDEX IF NOT EXISTS licenses_buyer_email ON licenses (buyer_email);

CREATE TABLE IF NOT EXISTS installations (
  installation_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  version TEXT NOT NULL DEFAULT '',
  trial_started_at INTEGER,
  trial_expires_at INTEGER,
  telemetry_enabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS daily_usage (
  installation_id TEXT NOT NULL REFERENCES installations(installation_id),
  usage_day TEXT NOT NULL,
  activity_day TEXT NOT NULL,
  automatic INTEGER NOT NULL DEFAULT 0 CHECK(automatic >= 0),
  manual INTEGER NOT NULL DEFAULT 0 CHECK(manual >= 0),
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (installation_id, usage_day)
);
CREATE INDEX IF NOT EXISTS usage_activity ON daily_usage(activity_day);
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  buyer_email TEXT NOT NULL,
  license_id TEXT REFERENCES licenses(license_id),
  plan_months INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  paid_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  license_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  client_hash TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS paid_activations (license_id TEXT NOT NULL, installation_id TEXT NOT NULL, first_activated_at INTEGER NOT NULL, PRIMARY KEY(license_id, installation_id));
CREATE TABLE IF NOT EXISTS daily_activity (installation_id TEXT NOT NULL REFERENCES installations(installation_id), activity_day TEXT NOT NULL, PRIMARY KEY(installation_id,activity_day));
