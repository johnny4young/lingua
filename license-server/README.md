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

## What ships in Slice 1

- Hono app skeleton with the full route map (`src/index.ts`).
- D1 schema migration (`migrations/0001_initial.sql`) for `licenses`,
  `devices`, and `trials`.
- Real `GET /health` endpoint.
- 501 stubs for `POST /trials/start`, `POST /licenses/activate`,
  `GET /licenses/status`, `POST /licenses/devices/remove`, and
  `POST /webhooks/polar` — every non-webhook endpoint validates
  request shape before returning the canonical
  `{ ok: false, reason: 'not-implemented' }` payload. The Polar webhook
  intentionally returns 501 without reading the body until Slice 2 adds
  signature verification.
- Vitest suite (`test/`) covering happy paths + invalid-input branches
  + method-mismatch / 404 routing + migration enum constraints.

## What does NOT ship in Slice 1

- No Polar webhook signature verification — Slice 2.
- No Resend email delivery — Slice 2.
- No actual D1 reads/writes — Slice 2.
- No Workers KV rate-limiter for `/trials/start` — Slice 2.
- No real Ed25519 token minting — Slice 2.
- No `/education/start` + `/education/renew` endpoints — Slice 4.
  The `lingua_education` SKU is reserved in the schema constraints + the
  ADR (free 1-year tier, renewable on `.edu` / GitHub-Education
  re-validation, server-minted just like `/trials/start` — never
  flows through Polar). The `educations` D1 table mirrors `trials`
  and lands alongside the endpoints in Slice 4.

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
