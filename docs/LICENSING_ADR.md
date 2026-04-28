# ADR — Licensing infrastructure (RL-059 / RL-061)

| Status | Accepted |
| ------ | -------- |
| Decision | Polar.sh + Cloudflare Worker + D1 + Resend; max-3-devices with self-service removal; opaque per-device UUID; web-update banner driven by a pull-based version endpoint. |
| Date | 2026-04-25 |
| Revisit | When annual Polar volume crosses ~$50K (margin case for Stripe-direct + tax automation re-opens), when Polar product/API direction materially diverges from the open-source SDK we depend on, or when the renderer needs offline-first device removal beyond what the live status endpoint covers. |

## Context

The Phase 1 launch needs an end-to-end licensing pipeline:

- A way to take payment globally without the maintainer becoming
  responsible for VAT / GST / sales-tax filings in every jurisdiction.
- License keys that the desktop and web apps can verify offline using
  the existing Ed25519 verifier in `src/shared/license.ts`.
- A device-binding strategy that prevents key sharing without
  punishing users who legitimately move between machines.
- A free-trial path with anti-abuse strong enough to keep an indie
  pilot honest, weak enough to avoid email-verification friction.
- A release pipeline that makes a desktop or web update visible to
  users through a single tag push.

This ADR captures the six decisions that frame `RL-059` (license
infrastructure) and `RL-061` (Polar integration), and locks the
shape of the new tickets that derive from them.

## Decision 1 — Vendor: Polar.sh

### Options considered

| Vendor | Fee | Merchant of Record | License keys | Risk |
|---|---|---|---|---|
| Polar.sh | 4% + $0.40 | Yes | First-class via products / benefits API | Founded 2023, API still moving |
| Stripe direct | 2.9% + $0.30 | No (Stripe Tax is +0.5% calc-only) | Implement custom | Tax filings per-jurisdiction become the maintainer's problem |
| LemonSqueezy | 5% + $0.50 | Yes | Native | Acquired by Stripe in 2024 — direction uncertain on a 12–24 month horizon |
| Paddle | 5% + $0.50 | Yes | Via API | KYC review takes 2–3 weeks; less ergonomic API |
| Gumroad | 10% | Yes | Yes | Fee too high; branded URL doesn't match the product |
| Stripe + tax SaaS (TaxJar/Quaderno) | ~3.5% combined | External | Custom | Largest legal/operational overhead for a sole maintainer |

### Decision

**Polar.sh.** The Merchant-of-Record model is the dominant factor:
for a sole maintainer launching a global commercial product, letting
the vendor remit VAT/GST/sales-tax across 100+ jurisdictions
collapses what would otherwise be months of legal/operational work
into a vendor relationship. Polar's first-class license-key surface
also avoids hand-rolling primitives on top of generic checkout
events. The 1.1% fee delta against Stripe-direct does not pay back
the global-tax overhead.

### Consequences

- Bottom-line fee on each sale is 4% + $0.40, billed by Polar.
- The contract surface we depend on is webhook signature + product
  metadata; both are auditable and OSS-SDK-backed. Lock-in is
  minimal — porting to Stripe is ~1 week if margin pressure or API
  drift forces it later.
- `RL-061` scope expands to include Polar product setup
  (`lingua_monthly`, `lingua_lifetime`, `lingua_team`) and webhook
  wiring (`order.paid`, `order.refunded`, `subscription.created`,
  `subscription.updated`, `subscription.canceled`).

## Decision 2 — License server: Cloudflare Worker `license-server/` + D1

### Options considered

- **Sibling Cloudflare Worker.** Same stack as the existing
  `update-server/` (already deploys via `wrangler.toml`, uses CF
  secrets, has observability enabled). State in D1 (SQLite
  serverless, 5M reads / 100K writes / 5GB storage on the free
  tier). Sibling rather than fused with `update-server` to keep
  surface separation: the update worker is a read-only proxy of
  GitHub releases, while the license worker has mutable state and a
  webhook receiving semi-public input.
- **Hosted Node service.** Render / Fly.io / Railway. Adds a new
  ops surface (a long-running container), separate billing, and
  separate observability.
- **Embed inside the existing `update-server/`.** Smallest
  infrastructure delta but worst surface separation; a license bug
  could in principle corrupt update flow.

### Decision

**Sibling Cloudflare Worker `license-server/` with D1
persistence.** Reuses the deploy pipeline, secret management, and
observability the maintainer already operates. D1 is well within
the free tier for the projected first-year volume (<10K licenses).
Subdomains: `updates.linguacode.dev` (existing) +
`licenses.linguacode.dev` (new).

### Consequences

- Schema lives in D1: `licenses`, `devices`, `trials` tables (full
  shape captured in the implementation plan and `RL-061` scope).
  `educations` joins in Slice 4 alongside the education endpoints.
- Endpoints (Slice 2 shipped 2026-04-27 except `/trials/start` +
  `/education/*` + `/licenses/recover` which land in Slice 4):
  - `POST /webhooks/polar` — Polar Standard Webhooks signature
  - `POST /trials/start` — Slice 4
  - `POST /education/start` — Slice 4
  - `POST /education/renew` — Slice 4
  - `POST /licenses/activate` — body includes `surface: 'desktop' |
    'web'`; activation enforces the per-surface bucket
  - `GET /licenses/status` — query carries `?deviceId=…&surface=…`;
    response groups devices by surface, includes `refreshedToken`
    when newer than the client's; server-minted token payloads include
    stable `licenseId` so an older signed token can still find the row
    after renewal replaces `licenses.token`
  - `POST /licenses/devices/remove` — soft-delete by `(license_id,
    device_id)` (cross-surface; renderer chooses which device to
    remove from the device-management UI)
  - `POST /licenses/recover` — Slice 4; emails the current
    `licenses.token` to the buyer, rate-limited per IP + per email
    via Workers KV, never leaks ownership (always 200)
  - `GET /health` — liveness check
- The same Ed25519 keypair signs in `license-server/` and verifies
  in the desktop + web apps. The private key lives only as a
  Cloudflare secret (`LINGUA_LICENSE_PRIVATE_KEY_JWK`).
- Paid Polar subscriptions mint or refresh tokens only after
  `order.paid`; `subscription.created` is not enough because Polar can
  send it before the first payment becomes active.

## Decision 3 — Pricing tiers + device limit

### Decision

Three Polar-priced SKUs:

- **`lingua_monthly`** — subscription, hard 3-device limit.
- **`lingua_lifetime`** — one-time, hard 3-device limit.
- **`lingua_team`** — metered, device limit configurable via Polar
  product `metadata.device_limit` (default 3 if absent).

Two server-minted tiers that **never enter the Polar product
catalog** — both reuse the trial pattern (no Polar webhook, no
checkout, server emits the token directly):

- **`tier: 'trial'`** — 14 days, 1 device, full Pro entitlements,
  one-shot. Minted by `/trials/start`. Same anti-abuse as below
  (UNIQUE email + UNIQUE device).
- **`tier: 'education'`** — 1 year, full Pro entitlements,
  **renewable** by re-validating an educational email. Minted by
  `POST /education/start`; renewed by `POST /education/renew` against
  the same license id (extends `expires_at` by another year). Sized
  for students + educators who validate via `.edu` domain or GitHub
  Education API (validation strategy locked in Slice 4). Anti-abuse
  same shape as trial: one active education license per email,
  per-IP rate-limit on issuance, KV-backed.

The `tier: 'pro'` device cap (3) applies to the education tier as
well — students reinstalling on a new laptop go through the same
`/licenses/devices/remove` flow as paid users.

### Consequences

- `licenses.product_id` enum gains `'lingua_education'`. `licenses.tier`
  enum gains `'education'`.
- `licenses` table carries `device_limit INTEGER NOT NULL DEFAULT 3`
  so the gate runs in SQL on activation. Education shares the
  hard-3 default with Monthly + Lifetime; only Team overrides via
  Polar metadata.
- The Polar webhook handler reads `metadata.device_limit` only for
  the team SKU; the other SKUs ignore overrides. Education + trial
  bypass the webhook entirely — they are server-minted by their
  dedicated endpoints.
- A new `educations` table (mirror of `trials`) holds the anti-abuse
  ledger: `UNIQUE(email)` + `UNIQUE(device_id)` so a single educator
  cannot stack multiple concurrent education tokens. Schema lands
  with Slice 4 alongside the endpoint code.
- Renewal is **explicit**: when `expires_at` approaches, the renderer
  prompts the user to re-validate the educational email; only on
  successful re-validation does the server extend `expires_at` and
  mint a refreshedToken. No silent renewal — if the user's `.edu`
  status lapses, the license expires gracefully.
- Settings → License surface displays `(N of {device_limit})` so
  Team customers see their actual budget, not a hard-coded "3".

## Decision 4 — Device fingerprint + self-service removal

### Decision

- The renderer never owns the device id. Main mints it on first
  launch with `crypto.randomUUID()` and persists it in
  `userData/device-id.json` (atomic write, mode 0o600 on POSIX).
- The id is opaque — not derived from hardware serials or any
  identifier the user can't rotate by reinstalling. This avoids
  privacy regressions and avoids brittle behavior in VMs / CI
  containers.
- `/licenses/activate` rejects when `count(active devices) >=
  device_limit`. The response carries the active device list so
  the app's modal can render "Remove from license" actions per
  device. Calls to `/licenses/devices/remove` are authorized by
  the license token alone — no separate account login is
  introduced in Phase 1.
- The current device cannot remove itself through the modal (would
  brick the running session); it removes itself through the
  Settings → License → "This device" → Clear path.

### Consequences

- A reinstall produces a new device id (the persisted file is
  gone). Server treats it as a new device. This is the intended
  behaviour and matches user expectations after a wipe / new
  laptop.
- A user changing computers releases their old device through the
  in-app modal; no support ticket required.
- The Phase 1 design intentionally has no remote "kick a device"
  surface beyond the in-app self-service. If support asks for it
  later, a signed CLI command against `licenses.linguacode.dev`
  is the smallest extension.

## Decision 5 — Free trial without email verification (Phase 1)

### Decision

- 14 days, full Pro entitlements, 1 device.
- Anti-abuse layered: `UNIQUE(email)` and `UNIQUE(device_id)` in
  the `trials` table, plus a per-IP rate limit of 3 trials/day on
  `/trials/start` enforced via Cloudflare KV.
- No magic-link verification in Phase 1. Friction for honest
  users (paste an email, wait for a click) outweighs the abuse
  delta the layered constraints already absorb.

### Consequences

- A determined abuser can churn through trials by changing email
  + reinstalling, but the friction is real and the cost of one
  additional trial slot is low at indie scale.
- Phase 2 can promote magic-link verification if observed abuse
  exceeds ~5% of trial volume; the schema and endpoint surface
  already support it.

## Decision 6 — Release / update propagation

### Decision

- **Pipeline.** A single `git tag v*` triggers a GitHub Actions
  workflow that builds the desktop installers, builds the web
  bundle, deploys the web bundle to Cloudflare Pages, and purges
  the `updates.linguacode.dev` cache. The workflow is the source
  of truth for "ship a release".
- **Web update banner.** A new endpoint
  `GET https://updates.linguacode.dev/web/version` returns the
  latest released version (read from the latest GitHub release).
  The web build polls every 30 minutes and surfaces a "Reload to
  update" notice when the remote version is newer than the
  build-time pin (`import.meta.env.VITE_LINGUA_VERSION`). Desktop
  build skips this checker — the native autoupdater in
  `src/main/updater.ts` already covers it.

### Consequences

- The current SW update path stays silent (the SW in
  `public/sw.js` activates new bundles transparently); the new
  banner is the first user-visible "your app is out of date"
  surface on web.
- These two pieces are tracked as `BACKLOG` items today (no
  acceptance criteria yet) and graduate to `RL-NNN` tickets once
  scoped:
  - `[infra] Unified release pipeline GH Actions for desktop +
    web + cache purge`
  - `[ui] Web shell update banner driven by /web/version
    endpoint`

## Slice sequencing

The implementation lands across slices to keep blast radius low:

1. **Slice 0 — Main-side IPC bridge (this commit).** No external
   dependency. `src/main/license.ts` owns persistence + verifier
   + device id; preload exposes `window.lingua.license.*`; the
   renderer store auto-detects and mirrors the bridge in desktop
   builds. Web build keeps its localStorage path unchanged.
2. **Slice 1 — `license-server/` worker scaffold.** D1 schema +
   `/health` + mocked `/trials/start` + `/licenses/activate`.
   No Polar wiring yet. Tests run under miniflare.
3. **Slice 2 — Polar webhook + Resend email.** Real signing,
   `subscription.*` + `order.*` handlers, real outbound email.
   Requires the maintainer's Polar account + Resend domain
   verification before end-to-end smoke is possible.
4. **Slice 3 — Device management UI.** Settings → License lists
   active devices, supports rename + remove, surfaces the
   exhausted-device modal during activation.
5. **Slice 4 — Free trial CTA.** Settings + landing-page hook
   for `/trials/start`.
6. **Slice 5 — Release pipeline + web update banner.** GH Actions
   workflow + `/web/version` endpoint + renderer banner.

## Maintainer-side prerequisites (out of agent scope)

These pieces are outside what the implementation agent can do
locally and unblock end-to-end smoke for Slices 2 onwards:

- Create the three Polar products and configure the webhook URL
  to `https://licenses.linguacode.dev/webhooks/polar`.
- Add `licenses.linguacode.dev` as a Cloudflare Workers route +
  custom domain.
- Provision the D1 database
  (`wrangler d1 create lingua-licenses`) and bind it to the
  worker.
- Set Cloudflare secrets: `POLAR_WEBHOOK_SECRET`, `POLAR_API_KEY`,
  `LINGUA_LICENSE_PRIVATE_KEY_JWK`, `RESEND_API_KEY`.
- Verify SPF/DKIM/DMARC for the Resend sender domain.
- Add `CLOUDFLARE_API_TOKEN` to GitHub Actions secrets for the
  release pipeline (Slice 5).
