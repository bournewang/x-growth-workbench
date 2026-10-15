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
