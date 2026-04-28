# `license-server/` — Lingua Cloudflare Worker

Sibling worker of `update-server/`, hosted at `licenses.linguacode.dev`.
Source-of-truth for license issuance, device tracking, trial minting,
and renewal token refresh. Ed25519 keypair-based — the desktop +
web apps verify with the public key embedded at build time
(`__LINGUA_LICENSE_PUBLIC_KEY_JWK__` define on main, `VITE_…` on
renderer); this worker holds the matching private key as a Cloudflare
secret.

Design and decisions: [`docs/LICENSING_ADR.md`](../docs/LICENSING_ADR.md).
Ticket: [`RL-061`](../docs/PLAN.md#rl-061-polarsh-integration).

## What ships in Slice 2

- Hono app skeleton with the full route map (`src/index.ts`) +
  request-time CORS middleware on `/licenses/*` and `/trials/*`
  reading `CORS_ALLOWED_ORIGINS` env so preview origins can be added
  without code changes.
- D1 schema migrations: `0001_initial.sql` (Slice 1) for `licenses` /
  `devices` / `trials`, plus `0002_add_surface_column.sql` (Slice 2)
  adding the per-surface device bucket from the 2026-04-26 design lock.
- Real `GET /health` endpoint.
- Real `POST /webhooks/polar` — Standard Webhooks v1 HMAC-SHA256
  signature verification, ±5 min replay window, constant-time compare,
  `whsec_` base64 unwrap. Dispatches `order.paid`, `order.refunded`,
  `subscription.created`, `subscription.updated`,
  `subscription.canceled`. Idempotent against `polar_order_id` /
  `polar_subscription_id` UNIQUE indexes. Mints Ed25519 tokens from
  paid `order.paid` events only: one-time lifetime purchases by order
  id, subscription Monthly/Team purchases or renewals by
  subscription id. `subscription.created` waits for payment;
  `subscription.updated` only updates cancel/uncancel status. Tokens
  persist via `src/lib/db.ts`; email sends via `src/lib/resend.ts`.
  Unknown events ack 200 with
  `{ ok: true, ignored: 'unknown-event' }`.
- Real `POST /licenses/activate` — verifies token signature, looks up
  the license row, enforces split-bucket device limit (3 desktop +
  3 web by default; configurable for `lingua_team` via Polar
  `metadata.device_limit`), idempotent re-activation when the same
  device id + surface is already registered.
- Real `GET /licenses/status` — verifies token, returns devices
  grouped by surface, includes `refreshedToken` when the persisted
  `licenses.token` is newer than what the client sent (Monthly
  renewal pickup). Server-minted payloads include a stable `licenseId`
  so a previously-issued signed token can still find the D1 row after
  renewal replaces `licenses.token`. Token comes from
  `Authorization: Bearer …`, never from the URL query (CF logs capture
  query params verbatim).
- Real `POST /licenses/devices/remove` — soft-deletes by
  `(license_id, device_id)`; idempotent for already-removed devices.
- 501 stubs still on `POST /trials/start` (Slice 4 implements with
  the renderer Trial CTA + KV rate-limiter).
- Vitest suite (`test/`) — 73 cases including pure unit tests for
  sign / polar / tokens, handler tests covering 501-when-unconfigured
  paths, validation rejections, and method/route fallthroughs. The
  in-memory D1 mock in `test/helpers.ts` covers the SQL shapes the
  handlers issue without a miniflare integration tier (flagged as
  MED follow-up — promote to `@cloudflare/vitest-pool-workers` once
  vitest 4 lands in the parent repo).

## What does NOT ship in Slice 2

- Renderer-side web `licenseStore` refactor — Slice 2.5. Today the
  web build still verifies locally; the server contract above is
  ready for it.
- Renderer-side device-management UI — Slice 3. Settings → License
  shows the bucketed devices and surfaces the exhausted modal.
- `POST /trials/start` real implementation — Slice 4 alongside the
  Trial + Education + Recovery CTAs.
- `POST /education/start` + `POST /education/renew` — Slice 4. The
  `lingua_education` SKU is reserved in the schema constraints + the
  ADR (free 1-year tier, renewable on `.edu` / GitHub-Education
  re-validation, server-minted, never flows through Polar). The
  `educations` D1 table mirrors `trials` and lands alongside the
  endpoints in Slice 4 via a new `0003_*.sql` migration.
- `POST /licenses/recover` — Slice 4. Email-based token re-issuance
  with KV rate-limit + audit log; never leaks ownership.
- Workers KV rate-limiter — Slice 4 (consumed by trials, education,
  and recovery). The KV binding is declared in `wrangler.toml` so
  Slice 4 doesn't need a config change.
- GitHub Actions release pipeline + web update banner — Slice 5.

## Maintainer-side prerequisites

Until these are done, `wrangler deploy` will fail. Slice 2 needs all
of them green to smoke end-to-end.

1. **Provision the D1 database**:
   ```bash
   wrangler d1 create lingua-licenses
   ```
   Copy the resulting `database_id` into `wrangler.toml` (replace the
   `TODO-after-wrangler-d1-create` placeholder).
2. **Apply the migration locally** to verify the schema:
   ```bash
   npm run migrations:apply:local
   ```
3. **Set the secrets** (Slice 2 will read them; Slice 1 ignores all):
   ```bash
   wrangler secret put POLAR_WEBHOOK_SECRET
   wrangler secret put POLAR_API_KEY
   wrangler secret put LINGUA_LICENSE_PRIVATE_KEY_JWK
   wrangler secret put RESEND_API_KEY
   ```
4. **Add the custom domain**: in Cloudflare Workers > Routes, attach
   `licenses.linguacode.dev` to this worker.
5. **Apply the migration to production** when ready to ship Slice 2:
   ```bash
   npm run migrations:apply:remote
   ```

## Local development

```bash
cd license-server
npm install
npm run dev
# → http://localhost:8787
curl http://localhost:8787/health
# → { ok: true, server: "lingua-license-server", version: "0.1.0" }
```

Smoke a stub endpoint:

```bash
curl -X POST http://localhost:8787/trials/start \
  -H 'content-type: application/json' \
  -d '{"email":"buyer@example.com","deviceId":"abc","deviceName":"laptop","os":"darwin"}'
# → 501 { ok: false, reason: "not-implemented", message: "Trial endpoint scaffolded …" }
```

## Tests

```bash
cd license-server
npm test
# → vitest run, 40 cases, all green
```

The Slice 1 suite runs the Hono app via `app.request(...)` — no
miniflare needed because none of the endpoints touch D1 yet. Slice 2
will add `@cloudflare/vitest-pool-workers` for the D1 + KV emulation
needed by trial issuance and rate-limiting.

## Why a sibling worker (not embedded in `update-server/`)

`update-server/` is a read-only proxy to GitHub Releases with no
mutable state. `license-server/` has webhooks, D1, secrets, and
mutable state. Keeping them as separate Workers means a license bug
can never corrupt the update flow, and each can deploy on its own
cadence. Same Cloudflare account, same observability dashboard,
different code.
