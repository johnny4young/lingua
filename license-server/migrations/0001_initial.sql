-- implementation — initial D1 schema.
--
-- Three tables, mirroring the LICENSING_ADR Decision 2 implementation design:
--   licenses — one row per minted license token
--   devices  — up to N active devices per license (device_limit drives N)
--   trials   — anti-abuse ledger (one trial per email + per device_id)
--
-- implementation ships only the schema. The handlers in src/handlers/* return 501
-- stubs; nothing writes to D1 yet. implementation wires Polar webhook + Resend
-- email and will populate the licenses + devices + trials tables.
--
-- Apply locally during development:
--   pnpm run migrations:apply:local
-- Apply against the production D1:
--   pnpm run migrations:apply:remote
-- Both wrap `wrangler d1 migrations apply` against the binding declared in
-- wrangler.toml.

CREATE TABLE IF NOT EXISTS licenses (
  -- Primary key (uuid v4 generated server-side).
  id                       TEXT PRIMARY KEY,
  -- Latest valid Ed25519 token emitted for this license. Refreshed on
  -- subscription.updated webhooks so the desktop client picks up
  -- extended expires_at via /licenses/status.
  token                    TEXT UNIQUE NOT NULL,
  -- Product identifier mapped 1:1 to a Lingua tier/source.
  -- Allowed:
  --   'lingua_monthly'   — subscription, billed via Polar
  --   'lingua_lifetime'  — one-time, billed via Polar
  --   'lingua_team'      — metered seats, billed via Polar
  --   'lingua_trial'     — server-minted, no Polar (14d, one-shot)
  --   'lingua_education' — server-minted, no Polar (1yr, renewable
  --                        via /education/renew on .edu/GitHub-Education
  --                        re-validation; lands in implementation)
  product_id               TEXT NOT NULL CHECK (
    product_id IN (
      'lingua_monthly',
      'lingua_lifetime',
      'lingua_team',
      'lingua_trial',
      'lingua_education'
    )
  ),
  -- Tier exposed to the renderer's entitlement matrix.
  -- Allowed: 'pro' | 'pro_lifetime' | 'team' | 'trial' | 'education'.
  -- Note: 'education' shares the full Pro entitlement set with 'pro' —
  -- the distinction is in `product_id` + the renewal model, not in what
  -- the user can do inside the app.
  tier                     TEXT NOT NULL CHECK (
    tier IN ('pro', 'pro_lifetime', 'team', 'trial', 'education')
  ),
  -- Hard 3 for monthly + lifetime, configurable for team via Polar
  -- product `metadata.device_limit`. Default 3 if Polar omits the key.
  device_limit             INTEGER NOT NULL DEFAULT 3 CHECK (device_limit >= 1),
  -- Buyer email (also the Resend recipient). Lower-cased on insert.
  issued_to                TEXT NOT NULL,
  -- Epoch seconds.
  issued_at                INTEGER NOT NULL,
  -- Epoch seconds; null for lifetime; epoch for trial + education + monthly + team.
  expires_at               INTEGER,
  -- Epoch seconds; offline grace window starts at this point.
  support_window_ends_at   INTEGER,
  -- 'active' | 'cancel_at_period_end' | 'refunded' | 'expired'.
  status                   TEXT NOT NULL CHECK (
    status IN ('active', 'cancel_at_period_end', 'refunded', 'expired')
  ),
  -- One-time orders carry polar_order_id; subscriptions carry
  -- polar_subscription_id. Trial and education rows carry neither.
  polar_order_id           TEXT,
  polar_subscription_id    TEXT,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS licenses_issued_to_idx ON licenses(issued_to);
CREATE INDEX IF NOT EXISTS licenses_polar_subscription_idx ON licenses(polar_subscription_id);

CREATE TABLE IF NOT EXISTS devices (
  -- Primary key (uuid v4 generated server-side).
  id              TEXT PRIMARY KEY,
  license_id      TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  -- Opaque per-install uuid minted by the Electron main process and
  -- persisted at userData/device-id.json. NOT a hardware fingerprint.
  device_id       TEXT NOT NULL,
  -- User-editable display label. Default seeded from os.hostname().
  device_name     TEXT NOT NULL,
  -- 'darwin' | 'win32' | 'linux'.
  os              TEXT NOT NULL CHECK (os IN ('darwin', 'win32', 'linux')),
  activated_at    INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  -- Soft delete. NULL while the device is active. Set to epoch seconds
  -- when the user removes the device through Settings → License or
  -- through the exhausted-devices modal during activation.
  removed_at      INTEGER,
  UNIQUE(license_id, device_id)
);

CREATE INDEX IF NOT EXISTS devices_license_active_idx
  ON devices(license_id, removed_at);

CREATE TABLE IF NOT EXISTS trials (
  -- Primary key (uuid v4 generated server-side).
  id           TEXT PRIMARY KEY,
  -- Lower-cased email at insert time.
  email        TEXT NOT NULL,
  -- Same opaque device_id as devices.device_id.
  device_id    TEXT NOT NULL,
  -- The license row this trial backs (tier='trial').
  license_id   TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  issued_at    INTEGER NOT NULL,
  -- Anti-abuse: one trial per email AND one trial per device_id.
  -- implementation layers a per-IP rate limit on /trials/start via Workers KV.
  UNIQUE(email),
  UNIQUE(device_id)
);
