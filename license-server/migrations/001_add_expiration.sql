-- Run once on databases created before expiration support. Existing licenses
-- remain without an expiration date; new/reissued codes receive one.
ALTER TABLE licenses ADD COLUMN expires_at INTEGER;
