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
- The canonical Lingua SKU identifier in every Polar webhook payload
  is `event.data.product.metadata.product_id`, NOT `product.id`.
  Polar's `product.id` is an autogenerated UUID that differs between
  sandbox and production and is opaque to humans, so the worker
  cannot match against it directly. The maintainer is responsible for
  setting `metadata.product_id` to one of `lingua_monthly`,
  `lingua_lifetime`, `lingua_team` when creating each product in the
  Polar dashboard. A webhook missing or carrying an unknown
  `metadata.product_id` is acked 200 with `ignored: 'unknown-product'`
  so a misconfigured product is loud in observability without
  triggering Polar's retry storm. The slug strings themselves are
  treated as **immutable for the lifetime of the deployment** — they
  are the public primary key of every license row in D1
  (`licenses.product_id`) and renaming them would require a D1
  migration plus redeploy.

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

## Decision 5 — Trial single-shot, Education magic-link two-step

> Updated 2026-04-29 (RL-061 Slice 4). Trial keeps the original
> single-shot semantics; Education flips to a magic-link two-step
> at the user's request to give the educational tier a confirmed
> proof of identity beyond the `.edu` regex.

### Decision

**Trial — single-shot mint.**

- 14 days, full Pro entitlements, 1 device.
- Anti-abuse layered: `UNIQUE(email)` and `UNIQUE(device_id)` in
  the `trials` table, plus a per-IP rate limit of 3 trials/day on
  `/trials/start` enforced via Cloudflare KV.
- No magic-link verification on Trial. Friction for honest users
  (paste an email, wait for a click) outweighs the abuse delta
  the layered constraints already absorb.

**Education — magic-link two-step.**

- 1 year, full Pro entitlements, 1 device, renewable.
- `POST /education/start` validates the `.edu` regex
  (`/^[^@\s]+@([a-z0-9-]+\.)*edu$/i` plus an explicit list of
  additional educational TLDs: `ac.uk`, `edu.mx`, `edu.au`,
  `edu.ca`, `edu.br`, `ac.in`), persists a row in
  `education_pending_confirmations` with a 24h TTL, and sends a
  confirmation email. Rate-limited per-IP (3/day).
- `GET /education/confirm?confirm=<id>` validates the pending
  row (not expired, not already confirmed), mints the
  education license + persists in `educations` + `licenses`,
  sends the canonical token email, returns an HTML success page.
  Idempotent on re-click — second hit re-renders the same
  success HTML without re-minting.
- Duplicate-email branch returns
  `{ ok: false, reason: 'email-already-active', canRecover: true }`.
  Renderer surfaces an inline Recover button that pre-fills
  RecoveryCta with the same email.

### Consequences

- Trial: a determined abuser can churn through trials by
  changing email + reinstalling, but the friction is real and
  the cost of one additional trial slot is low at indie scale.
  Phase 2 can promote magic-link verification if observed abuse
  exceeds ~5% of trial volume; the schema already supports it.
- Education: the magic-link confirms the user has access to the
  `.edu` inbox before any license is minted, materially raising
  the bar for educational-tier abuse. The 24h TTL + single-use
  semantics keep replay tight. The `.edu` regex stays
  conservative; broader institution coverage (e.g. private
  universities with `.com` domains) is filed in BACKLOG as a
  GitHub Education API integration.

## Decision 7 — Recovery is no-info-leak by default

### Decision

`POST /licenses/recover/start` ALWAYS responds 200 + neutral
copy regardless of whether the email matches a known license,
hits a rate limit, or is shape-valid-but-empty. Concretely:

- The pending row in `recovery_pending_confirmations` is created
  even for unknown emails, so the timing of the response matches
  across known / unknown branches.
- `GET /licenses/recover/confirm?confirm=<id>` returns the same
  generic success HTML for "we sent the token" and "no matching
  license". The only differentiable response is "link expired"
  (status 410) which is unavoidable to convey staleness.
- Two rate-limit scopes — per-IP (5/day) AND per-email (3/day) —
  defend against both single-attacker and distributed-attack
  patterns. Both fire the same neutral 200 so the response shape
  never tells the attacker which limit fired.
- Server misconfiguration (e.g. `RESEND_API_KEY` missing) renders
  the same generic success HTML rather than a 501; the operator
  sees the issue via `console.error`, the user does not.

### Consequences

- An attacker enumerating emails learns nothing useful from the
  worker's responses.
- Honest users with no Lingua license still see the same "if
  that email matches a Lingua license, the recovery email is on
  its way" copy. We accept the small UX cost of not telling
  people "no license here" because the alternative is an
  enumeration primitive.
- The `RecoveryCta` renderer-side mirror uses the same neutral
  copy, so the renderer never differentiates known vs unknown.

## Decision 8 — Token re-mint on renewal is transparent to the user

### Decision

When a paid renewal lands (Polar `order.paid` for Monthly), or
the user renews their education license via `/education/renew`,
or any future renewable tier expires + renews, the worker
re-mints the license token (new `expiresAt`, new
`supportWindowEndsAt`, same `licenseId`, same `productId`, same
`issuedTo`) and stores it in `licenses.token`. The renderer
picks up the new token silently via `/licenses/status`'s
`refreshedToken` field — the user never re-pastes.

The mechanism that makes this work end-to-end:

1. **Server.** `findCurrentLicenseForToken`
   (`license-server/src/handlers/licenses.ts`) walks the
   `licenseId` lookup if `licenses.token` no longer matches the
   client's stored token. As long as the old token's signature
   is valid and `productId` + `issuedTo` match the canonical
   row, the server returns the new `licenses.token` via
   `refreshedToken` in the `/licenses/status` response.
2. **Renderer (web).**
   `src/renderer/stores/licenseStore.ts:revalidate` checks
   `result.refreshedToken` and swaps it in when it strictly
   newer than the stored token (compared via `decodeIssuedAt`).
   Slice 4 also adds a parallel path in `setLicenseToken`: if
   local verify on a paste returns
   `invalid:expired` (signature still valid), the renderer
   attempts `/licenses/status` BEFORE giving up. The same
   `findCurrentLicenseForToken` resolves the stale token to the
   current row and returns the refreshed token.
3. **Renderer (desktop).**
   `src/main/license.ts:revalidate` mirrors the web flow via
   the IPC bridge. The desktop-side stale-token auto-pickup on
   `setLicenseToken` is filed as a Phase 2 follow-up — the
   user's primary scenario for the stale-token path is the web
   user re-installing the app.

### Why we cannot keep a static token across renewals

Tokens are signed with the issuer's Ed25519 private key. The
payload baked into the signature includes `expiresAt` AND
`supportWindowEndsAt`. Both are read by the LOCAL verifier
(`src/shared/license.ts` and `src/main/license.ts`) for the
24h offline-grace window per Decision 4 — the local verifier
cannot read a server clock, so the support window has to live
in the signed payload.

If we kept a static token across renewals:

- After the initial `expiresAt` lapsed, the renderer's local
  verify would fire `invalid:expired` and the user would lose
  Pro features until the next online revalidate. That defeats
  the offline-grace contract.
- We would also lose the cryptographic binding between
  "currently active" and "the token in the user's pocket" —
  a leaked or refunded token would stay forever-active until
  the database invalidates it, which we cannot prove
  cryptographically without re-mint.

The alternative — re-mint on renewal — keeps both invariants
(local offline-grace + cryptographic revocation) at the cost
of a silent token swap that the renderer absorbs transparently.

### Consequences

- Subscription users never re-paste tokens. They renew through
  Polar, the worker re-mints, the next `/licenses/status` poll
  picks up the new token. From the user's perspective, the app
  just stays Active.
- Education users who renew via `/education/renew` see the same
  silent swap.
- The renderer's stale-token UX (paste a year-old token →
  silent pickup → Active) only works while the license row is
  still active in D1. If the license is revoked / refunded /
  cancelled past the cancel-at-period-end window, the renderer
  surfaces a `recoverHint` that drops the user into the
  recovery magic-link flow.

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

The implementation lands across slices to keep blast radius low.
Updated 2026-04-29 to reflect Slice 4 shipped:

1. **Slice 0 — Main-side IPC bridge.** SHIPPED 2026-04-25. No
   external dependency. `src/main/license.ts` owns persistence +
   verifier + device id; preload exposes `window.lingua.license.*`;
   the renderer store auto-detects and mirrors the bridge in
   desktop builds. Web build keeps its localStorage path unchanged.
2. **Slice 1 — `license-server/` worker scaffold.** SHIPPED
   2026-04-26. D1 schema + `/health` + 501-stubs for the four
   Slice-2 endpoints. No Polar wiring yet.
3. **Slice 2 — Polar webhook + Resend email.** SHIPPED 2026-04-27.
   Real signing, `subscription.*` + `order.*` handlers, real
   outbound email, surface-aware D1 device limit. Requires the
   maintainer's Polar account + Resend domain verification for
   end-to-end smoke.
4. **Slice 2.5 — Web licenseStore server-aware refactor.** SHIPPED
   2026-04-28. The web build now calls `/licenses/{activate,status,
   devices/remove}` with `surface: 'web'`, picks up Monthly
   `refreshedToken` on rehydrate, falls back to local-verify within
   the 24h offline-grace.
5. **Slice 3 — Web device management UI.** SHIPPED 2026-04-28.
   Settings → License lists active devices per surface, supports
   remove, surfaces the exhausted-devices remediation modal during
   activation. Rename intentionally deferred (no `/licenses/devices/rename`
   endpoint yet — tracked in `BACKLOG.md`).
6. **Slice 3.5 — Desktop main-side `/licenses/*` wiring.** SHIPPED
   2026-04-29. Main bridge calls `/licenses/{activate,status,devices/remove}`
   with `surface: 'desktop'`, registers the device in the per-surface
   bucket, picks up `refreshedToken`, re-activates when
   `deviceRegistered: false`. Renderer's desktop branch mirrors the
   extended snapshot so the Devices section renders under the same
   gate the web build already passes.
7. **Slice 4 — Trial + Education magic-link + Recovery magic-link
   CTAs.** SHIPPED 2026-04-29. `/trials/start` (single-shot mint),
   `/education/{start,confirm,renew}` (magic-link two-step with
   `.edu` allow-list), `/licenses/recover/{start,confirm}` (no-info-leak
   magic-link). Renderer ships TrialCta + EducationCta + RecoveryCta
   under `status === 'free'` plus a stale-token auto-pickup
   path through `/licenses/status` lookup-by-licenseId. KV
   rate-limit binding (`RATE_LIMIT`) + D1 migration `0004`
   (educations + 2 pending-confirmation tables) land in this
   slice. See Decision 5 (Education magic-link), Decision 7
   (Recovery no-info-leak), Decision 8 (transparent token
   re-mint).
8. **Slice 5 — Release pipeline + web update banner.** PENDING.
   GH Actions workflow + `/web/version` endpoint + renderer banner.

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
