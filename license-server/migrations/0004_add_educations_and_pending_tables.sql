-- implementation — educations + magic-link pending-confirmation tables.
--
-- Three new tables:
--
--   1. `educations` — mirror of `trials`  with the same
--      anti-abuse UNIQUE shape: one active education plan per email
--      AND per device. Insertion happens at the END of the
--      magic-link flow (`GET /education/confirm` after the user
--      clicks the email link), not at `POST /education/start`. The
--      pending step keeps abuse cheap to detect without polluting
--      the canonical `licenses` table with unconfirmed rows.
--
--   2. `education_pending_confirmations` — temporary rows holding
--      the user-supplied (email, device_id, device_name, os) plus
--      the magic-link confirm-token. 24h TTL. Marked
--      `confirmed_at` on the first GET hit. Subsequent hits with
--      the same id are idempotent (re-render the success page,
--      do NOT mint a second education license).
--
--   3. `recovery_pending_confirmations` — same shape as #2 minus
--      the device columns. Recovery does not register a new
--      device — the user is recovering an EXISTING license, the
--      device(s) on that license stay untouched.
--
-- D1 atomicity: each `wrangler d1 execute` invocation runs in its
-- own transaction. No explicit BEGIN/COMMIT here (D1 rejects them
-- per the 0003 migration note). If any DDL fails, D1 rolls back
-- to pre-migration state and the operator can safely retry.
--
-- Apply locally during development:
--   pnpm run migrations:apply:local
-- Apply against the production D1:
--   pnpm run migrations:apply:remote
--
-- Apply order matters: this migration MUST land in prod D1 BEFORE
-- the worker is redeployed with the implementation handlers, otherwise
-- in-flight `/education/start` and `/licenses/recover/start`
-- requests would pass validation but fail the INSERT.

CREATE TABLE IF NOT EXISTS educations (
  -- Primary key (uuid v4 generated server-side).
  id           TEXT PRIMARY KEY,
  -- Lower-cased email at insert time. Same shape as trials.
  email        TEXT NOT NULL,
  -- Same opaque device_id as devices.device_id.
  device_id    TEXT NOT NULL,
  -- The license row this education plan backs (tier='education').
  license_id   TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  issued_at    INTEGER NOT NULL,
  -- Anti-abuse: one active education per email AND one per device.
  -- Per-IP rate-limit lives in Workers KV (lib/rateLimit.ts).
  UNIQUE(email),
  UNIQUE(device_id)
);

CREATE INDEX IF NOT EXISTS educations_email_idx ON educations(email);
CREATE INDEX IF NOT EXISTS educations_device_idx ON educations(device_id);

CREATE TABLE IF NOT EXISTS education_pending_confirmations (
  -- Primary key doubles as the magic-link confirm-token. The URL
  -- the user clicks is `https://licenses.linguacode.dev/education/confirm?confirm=<id>`.
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  device_id    TEXT NOT NULL,
  device_name  TEXT NOT NULL,
  os           TEXT NOT NULL,
  -- Epoch seconds. Used for the 24h TTL.
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  -- NULL until the user clicks the link. Subsequent clicks are
  -- idempotent — handler reads this column, sees it is NOT NULL,
  -- re-renders the success page without minting a second license.
  confirmed_at INTEGER
);

CREATE INDEX IF NOT EXISTS education_pending_email_idx ON education_pending_confirmations(email);

CREATE TABLE IF NOT EXISTS recovery_pending_confirmations (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  confirmed_at INTEGER
);

CREATE INDEX IF NOT EXISTS recovery_pending_email_idx ON recovery_pending_confirmations(email);
