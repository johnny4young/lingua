# Lingua license server

Cloudflare Worker for license issuance, activation, device management, trials,
education access, recovery, and Polar purchase webhooks. Production is expected
at `https://licenses.linguacode.dev`.

## HTTP contract

Every API response uses a tagged union and disables caching:

```json
{ "ok": true }
{ "ok": false, "reason": "machine-readable-code", "message": "Safe detail" }
```

Current routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness probe. |
| `GET` | `/health/ready` | D1, KV, Polar, and Resend readiness. |
| `POST` | `/webhooks/polar` | Verify and process Polar purchase events. |
| `POST` | `/licenses/activate` | Verify a signed token and register the current device. |
| `GET` | `/licenses/status` | Return entitlement and device status for a bearer token. |
| `POST` | `/licenses/devices/remove` | Remove a linked device. |
| `POST` | `/trials/start` | Rate-limited trial issuance. |
| `POST` | `/education/start` | Start education-email verification. |
| `GET` | `/education/confirm` | Confirm the emailed education link. |
| `POST` | `/education/renew` | Renew verified education access. |
| `POST` | `/licenses/recover/start` | Start license recovery. |
| `GET` | `/licenses/recover/confirm` | Confirm the emailed recovery link. |

Known routes return `405` plus `Allow` for unsupported methods. Unknown routes
return the JSON `not-found` shape rather than Hono's text fallback.

## Security model

- License tokens are signed with Ed25519 and verified against the configured
  public JWK; private signing material is a Worker secret and never enters app
  or website bundles.
- Polar webhooks require HMAC verification and D1-backed idempotency.
- Trial, education, and recovery starts use KV rate limits. Email proof remains
  authoritative because KV is eventually consistent across PoPs.
- Browser CORS is an explicit comma-separated allowlist. Polar webhooks do not
  use browser CORS.
- Request logs are structured and redacted; unhandled errors return a generic
  `internal-error` without stack traces.

## Required bindings and secrets

Bindings in `wrangler.toml`:

- `DB` — D1 database `lingua-licenses`
- `RATE_LIMIT` — Workers KV rate-limit namespace

Secrets:

```bash
pnpm exec wrangler secret put POLAR_WEBHOOK_SECRET
pnpm exec wrangler secret put POLAR_API_KEY
pnpm exec wrangler secret put LINGUA_LICENSE_PRIVATE_KEY_JWK
pnpm exec wrangler secret put LINGUA_LICENSE_PUBLIC_KEY_JWK
pnpm exec wrangler secret put RESEND_API_KEY
```

Never commit private JWKs, webhook secrets, API keys, real tokens, or `.dev.vars`.
The committed license-key registry contains public thumbprints only.

## Local development

From `license-server/`:

```bash
pnpm install
pnpm run migrations:apply:local
pnpm run dev
```

Use dummy local secrets in an ignored `.dev.vars`. Email HTML/CSS files are
loaded as text in both Wrangler and Vitest.

## Validation and deployment

```bash
pnpm run typecheck
pnpm test
pnpm run migrations:apply:remote
pnpm run deploy
```

Apply remote migrations before deploying handlers that depend on them. After
deploy, verify `/health/ready`, exercise a non-production entitlement flow, and
confirm structured logs contain no token, email, device identifier, or secret.
