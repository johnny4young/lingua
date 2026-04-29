-- RL-061 Slice 3 follow-up — relax the `devices.os` CHECK constraint.
--
-- Slice 2.5 introduced `surface: 'web'` activation but left the original
-- 0001-era `CHECK (os IN ('darwin', 'win32', 'linux'))` constraint in
-- place. The web renderer's `getOs()` helper emits `web-${browserFamily}`
-- (chrome / firefox / safari / edge / opera / brave / chromium / unknown)
-- so that the device list can distinguish browsers without colliding
-- with desktop OS strings. With the original CHECK, every web activate
-- attempted against prod D1 fails the INSERT and the renderer falls
-- back to local-verify with `serverSync='unreachable'` — the
-- per-surface device cap that LICENSING_ADR Decision 4 promised has
-- been silently bypassed since 2026-04-28.
--
-- SQLite (and therefore D1) does not support `ALTER TABLE ... DROP
-- CONSTRAINT`, so we rebuild the table:
--   1. Create a new `devices` shape with the relaxed `os` column.
--   2. Copy every row across.
--   3. Drop the old table and rename.
--   4. Recreate the indexes that 0001 + 0002 declared.
--
-- The new column has no enum CHECK at the schema layer — request-side
-- validation in src/lib/validation.ts:validateOsField is the bound
-- (lowercase letters/digits with optional hyphens, 64-byte UTF-8 cap).
-- Schema-side over-constraint forces a migration every time the
-- renderer gains a browser-detection branch, which is the wrong
-- coupling for a display-only field.
--
-- Atomicity: D1 wraps each `wrangler d1 execute` invocation in its own
-- transaction, so explicit BEGIN/COMMIT/PRAGMA control statements are
-- not just unnecessary — they are rejected by the D1 runtime
-- ("To execute a transaction, please use state.storage.transaction()").
-- The DDL below relies on that implicit wrap. If any statement throws
-- during apply, D1 returns the database to its pre-migration state and
-- the operator can safely retry.
--
-- Apply locally during development:
--   npm run migrations:apply:local
-- Apply against the production D1:
--   npm run migrations:apply:remote
--
-- Apply order matters: this migration MUST land in prod D1 BEFORE the
-- worker is redeployed with the relaxed validator, otherwise an
-- in-flight web activate would pass validation but fail the INSERT.
-- The reverse order (validator before migration) leaves the system in
-- the same broken state it is in now, so it is also safe to run the
-- migration first and the worker deploy second.

CREATE TABLE devices_new (
  id              TEXT PRIMARY KEY,
  license_id      TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_id       TEXT NOT NULL,
  device_name     TEXT NOT NULL,
  -- Free-form display label. The handler-side validator caps it at 64
  -- bytes and enforces the `^[a-z0-9]+(?:-[a-z0-9]+)*$` shape; no SQL
  -- enum here so future surfaces (mobile, tauri, etc.) do not require a
  -- migration.
  os              TEXT NOT NULL,
  activated_at    INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  removed_at      INTEGER,
  surface         TEXT NOT NULL DEFAULT 'desktop'
                  CHECK (surface IN ('desktop', 'web')),
  UNIQUE(license_id, device_id)
);

INSERT INTO devices_new (
  id, license_id, device_id, device_name, os, activated_at, last_seen_at, removed_at, surface
)
SELECT
  id, license_id, device_id, device_name, os, activated_at, last_seen_at, removed_at, surface
FROM devices;

DROP TABLE devices;

ALTER TABLE devices_new RENAME TO devices;

-- Recreate the indexes from 0001 + 0002. SQLite does not carry indexes
-- across the rename so they must be re-declared explicitly.
CREATE INDEX IF NOT EXISTS devices_license_active_idx
  ON devices(license_id, removed_at);

CREATE INDEX IF NOT EXISTS devices_license_surface_active_idx
  ON devices(license_id, surface, removed_at);
