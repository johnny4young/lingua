# Release Security Checklist

Use this checklist before promoting any public Lingua release from draft to
published. It complements `RELEASE.md`; it does not replace the operational
release checklist.

## Electron And Preload

- Confirm Electron security settings still disable unsafe navigation and
  untrusted window creation.
- Confirm preload exposes only typed, intentional bridge methods.
- Review any new `window.lingua` API for least privilege and input validation.

## IPC And Filesystem

- Confirm filesystem IPC uses `rootId` plus `relativePath`, never raw renderer
  absolute paths.
- Confirm protected paths and symlink containment are covered by tests.
- Confirm watcher ids are opaque and do not expose local filesystem paths.

## Runners

- Confirm JavaScript, TypeScript, Python, Go, and Rust stop/timeout behavior is
  covered.
- Confirm native Go/Rust detection and execution use the filtered environment.
- Confirm runner output caps, truncation, and locale markers still work.

## Updates And Release Artifacts

- Confirm release workflow audit gates passed.
- Confirm packaged smoke passed offline against the produced app.
- Confirm `SHA256SUMS.txt` exists and was verified.
- Confirm GitHub Release `latest*.yml` manifests reference only attached
  installers and blockmaps.
- Confirm the draft candidate passed
  `docs/runbooks/desktop-update-draft-validation.md`, then run the real updater
  smoke immediately after promotion.

## Signature chain

This section traces the desktop update signature chain end to end —
**manifest → installer → on-disk binary** — and records which release-time
gate enforces each link. Setup for the credentials referenced here lives in
[`MACOS_SIGNING.md`](./MACOS_SIGNING.md) and
[`WINDOWS_SIGNING.md`](./WINDOWS_SIGNING.md).

### macOS (electron-updater / Developer ID + notarization)

1. **Manifest** — `electron-updater` fetches `latest-mac.yml` directly from the
   public GitHub Release. The manifest lists arm64 and x64 zip assets with
   SHA-512 digests; the updater selects the host-native architecture.
2. **Installer / ZIP** — electron-builder produces per-architecture dmg + zip
   outputs, signs the app with the Developer ID Application identity, submits
   it to Apple `notarytool`, and staples the notarization ticket.
3. **On-disk binary** — the update path preserves the signed application
   bundle, while macOS Gatekeeper validates its Developer ID signature and
   stapled notarization ticket before first launch.

Release-time gates verify both architecture outputs, every zip referenced by
`latest-mac.yml`, and a packaged offline smoke. The smoke resolves the app for
the runner architecture and fails rather than silently validating an Intel app
under Rosetta. Signing/notarization is enabled when Apple credentials exist;
an ad-hoc build is validation-only and must not be represented as notarized.

### Windows (NSIS / Authenticode + latest.yml integrity)

1. **Manifest** — `electron-updater` fetches `latest.yml` directly from the
   public GitHub Release; it carries the installer URL, SHA-512, and size.
2. **Installer** — electron-builder produces one x64 NSIS `.exe` and blockmap.
3. **Packaged structure** — the release gate verifies `lingua.exe`, `app.asar`,
   and the embedded GitHub updater provider before upload.
4. **Authenticode** — when `WIN_CERT_FILE` and `WIN_CERT_PASSWORD` exist,
   `Get-AuthenticodeSignature` must report `Valid`. Without them the workflow
   emits an explicit unsigned-preview warning; SmartScreen trust is not claimed.

### Linux (AppImage)

Linux publishes an AppImage plus `latest-linux.yml`. Integrity is provided by
the manifest SHA-512 and release `SHA256SUMS.txt`; Authenticode and Apple
notarization do not apply.

### Decision: manifest-signing layer (Ed25519 over the feed JSON)

**Deferred.** The user-protecting integrity checks currently sit below the feed
JSON rather than inside it: electron-updater validates the SHA-512 metadata,
macOS applies Developer ID/Gatekeeper checks, and signed Windows releases carry
Authenticode. GitHub serves the manifest and installer over HTTPS.
An Ed25519 signature over the manifest would add defense-in-depth against a
compromised feed _origin_ or GitHub release publication path, but it is not the
next shipping blocker while platform signing, checksums, and draft-first
publication gates are enforced.

Revisit this decision when **any** of the following becomes true:

- Update binaries are served from a non-GitHub origin that does not carry
  per-asset code signatures / notarization (e.g. a self-hosted byte mirror).
- A target platform lacks an OS signature or equivalent verified installer boundary.
- The feed starts returning anything the client acts on **without** an
  OS-level signature check (e.g. auto-applied config rather than a signed
  binary).

## Licensing

- Confirm license tokens are never logged in URLs.
- Confirm activation/status/remove-device paths preserve device caps and tagged
  errors.
- Confirm private license-signing keys exist only in secret stores.
- Confirm the `Assert license-key rotation policy` gate passed (it runs in
  `release.yml` `security-audit`, `deploy-web.yml`, and CI).

### License-signing key rotation

The app embeds exactly one Ed25519 public key
(`LINGUA_LICENSE_PUBLIC_KEY_JWK` in `.env` + `.env.production`); the private
half exists only as the Cloudflare Workers secret
`LINGUA_LICENSE_PRIVATE_KEY_JWK` in `license-server`. The key is stripped to
RFC 8037 §2 fields, so it carries no `kid` or issue date — rotation metadata
lives in [`security/license-key-registry.json`](./security/license-key-registry.json),
keyed by the RFC 7638 JWK thumbprint.

**Policy.** Keys rotate at most every `rotationSlaDays` (90). The guard
(`scripts/assert-license-key-rotation.mjs`, alias
`pnpm run check:license-rotation`) fails the release, web deploy, and CI when
the embedded key is past the SLA, not documented in the registry, not
`active`, or drifted between the two env files. It emits a non-blocking
warning during the last `warnWindowDays` (14) before the breach — rotate when
the warning appears, not when the gate goes red.

**Where to read the fingerprint.** The guard prints the thumbprint on every
run; the running app shows the same value in **Settings → License → Signing
key fingerprint** (with a Copy button); `pnpm run dev:web:pro` /
`dev:desktop:pro` print the session key's fingerprint in the launch banner.
All three must agree with the registry's `active` entry.

**Rotation procedure (mint → embed → ship → retire).** Rotating invalidates
the signature on every outstanding token minted with the old key. Server-
verified tiers recover automatically: clients receive a `refreshedToken` on
their next `/licenses/status` call (or ride the documented 24-hour offline
grace window). Tokens that never re-sync (offline/lifetime
issuance) must be re-issued to the customer — plan support comms before
rotating.

1. Mint a fresh production keypair with
   `node scripts/mint-dev-license.mjs` (see its doc-comment for the
   prod-keypair extraction pattern; `jq -r`, never `-c`). Note the
   fingerprint printed as `publicKeyJwkThumbprint`.
2. Update the Cloudflare Workers secrets in `license-server`:
   `wrangler secret put LINGUA_LICENSE_PRIVATE_KEY_JWK` and
   `LINGUA_LICENSE_PUBLIC_KEY_JWK`.
3. In the SAME commit: replace `LINGUA_LICENSE_PUBLIC_KEY_JWK` in **both**
   `.env` and `.env.production`, append the new key to
   `security/license-key-registry.json` (`status: "active"`, `issuedAt` =
   today), and flip the previous entry to `status: "retired"` with a
   `retiredAt`. The guard enforces exactly one `active` entry.
4. Run `pnpm run check:license-rotation` locally — it must print `ok` with
   the new thumbprint.
5. Rebuild and redeploy desktop + web immediately (a stale deployed bundle
   still verifies against the retired key and rejects newly minted tokens).
6. Verify in the shipped build: Settings → License fingerprint matches the
   new registry entry.

Never delete registry entries — retired rows are the audit trail of every
key that ever shipped.

## Telemetry And Crash Reporting

- Confirm telemetry and crash reporting are opt-in and kill-switchable.
- Confirm payload redaction excludes code, file paths, env values, license
  tokens, and arbitrary exception payloads.

## Dependencies And Notices

- Confirm `pnpm run check:licenses` passes.
- Confirm `pnpm run compliance:release` generated `lingua-sbom.cyclonedx.json`
  and `THIRD_PARTY_LICENSE_REPORT.md`.
- Confirm `THIRD_PARTY_NOTICES.md` and
  `docs/THIRD_PARTY_LICENSE_REPORT.md` are current.
- Confirm public builds do not introduce AGPL/commercial runtime dependencies
  without an explicit license decision.
- Confirm no disallowed runtime license ships in packaged artifacts.
- Confirm the `pnpm run check:prod-audit` gate passed (it runs in CI on every
  PR and in `release.yml` security-audit).

### Production dependency audit gate

`pnpm run check:prod-audit` (`scripts/assert-prod-audit.mjs` over the pure
`scripts/lib/prodAudit.mjs`) runs `pnpm audit --prod --json`, applies a
severity threshold (default `high`), and **fails closed** — a `high` or
`critical` advisory in the production dependency graph, an unparseable audit
payload, or a `pnpm audit` that could not run all exit non-zero. It is wired
into `ci.yml` (PR gate) and `release.yml` (security-audit job), so a prod
advisory is caught before merge, not only at release time.

**Prod-vs-full split — deliberate, do not "fix".** Only the PRODUCTION graph
is blocking. The dev-inclusive full audit (`pnpm audit --audit-level high`)
stays advisory (`continue-on-error: true`): its `high` findings (e.g. the
`esbuild` GHSA reached through `vite` / `@electron-forge/*`, and the dev-only
`tar` advisory) are unfixable without upstream electron-forge / vite upgrades
and never ship in a packaged artifact. Making the full audit blocking would
red-CI the repo on dev-tooling advisories that pose no user risk. Keep the
split.

**Bypass procedure (vendored exception).** If a production `high` advisory has
no available fix and the risk is assessed acceptable for a release:

1. Document the advisory id, the affected package + path (`pnpm why <pkg>`),
   the risk assessment, and the planned remediation date in the PR
   description.
2. Add a transitive `pnpm.overrides` pin in `package.json` to the patched
   version if one exists; re-run `pnpm run check:prod-audit` to confirm green.
3. If no patched version exists, raise the gate threshold for that single run
   only via `node scripts/assert-prod-audit.mjs --level critical` in a
   dedicated commit whose message records the vendored exception, and open a
   tracking entry in the maintenance notes. Never weaken the default `high`
   threshold in CI without that paper trail. `critical` production advisories
   remain release-blocking under this procedure; they need a patched dependency
   or a separate maintainer-approved incident exception.

## Public Documentation Claims

- Confirm README, LICENSE, SECURITY, PRIVACY, press-kit, and release notes all
  describe the same source-available commercial posture.
- Confirm no Markdown file contains machine-local absolute links.
- Confirm no doc claims a checkout, download, plugin ecosystem, or hosted
  feature that is not live.
