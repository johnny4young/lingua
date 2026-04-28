-- RL-061 Slice 2 — split-bucket device limit (web vs desktop).
--
-- The 2026-04-26 design lock decided that web counts as a first-class
-- surface for licensing, but separately from desktop: a license carries
-- `device_limit` desktop slots PLUS `device_limit` web slots, instead of
-- a shared pool. This migration adds the `surface` column on `devices`
-- that lets activation count slots per-surface.
--
-- Default 'desktop' so existing rows (none today; placeholder) stay
-- coherent. The CHECK constraint locks the enum at the SQL layer; the
-- handler-side validator in src/lib/validation.ts enforces the same
-- enum at the request boundary.
--
-- The `licenses.device_limit` column is unchanged — it now means
-- "max devices PER SURFACE" rather than "max devices total". Team
-- products that override via Polar `metadata.device_limit: N` apply N
-- to BOTH surfaces (so a metadata.device_limit:10 Team license gets
-- 10 desktop + 10 web slots = 20 total). Asymmetric per-surface limits
-- (e.g. 50 desktop + 5 web) require a follow-up migration once a
-- customer requests it; the v1 design keeps the shape symmetric.
--
-- Apply locally during development:
--   npm run migrations:apply:local
-- Apply against the production D1:
--   npm run migrations:apply:remote

ALTER TABLE devices
  ADD COLUMN surface TEXT NOT NULL DEFAULT 'desktop'
    CHECK (surface IN ('desktop', 'web'));

-- Drop the old unique-by-device_id index (implicit from UNIQUE(license_id, device_id))
-- and replace it with one that includes surface so a single license can
-- have the same device_id on both surfaces (a user pasting their token in
-- both their desktop install and their browser legitimately produces the
-- same opaque deviceId in both places when they happen to use the same
-- random UUID seed — exceedingly rare but the schema must allow it).
--
-- D1 doesn't support `DROP INDEX` on implicit UNIQUE constraints. Instead
-- we rely on the application-side activation logic to enforce uniqueness
-- per (license_id, device_id, surface) — the original UNIQUE(license_id,
-- device_id) from 0001 stays in force, but in practice the renderer
-- mints distinct device_id values per surface (userData uuid for
-- desktop vs localStorage uuid for web) so collisions are accidental
-- and harmless.
--
-- A future migration can drop the original UNIQUE(license_id, device_id)
-- and replace with UNIQUE(license_id, device_id, surface) once a
-- legitimate same-device-id-cross-surface case appears in practice.

CREATE INDEX IF NOT EXISTS devices_license_surface_active_idx
  ON devices(license_id, surface, removed_at);
