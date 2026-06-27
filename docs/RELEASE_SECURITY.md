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
- Confirm production update-server responses do not expose draft or malformed
  versions.
- Confirm any macOS/Windows release ran
  `docs/runbooks/desktop-update-draft-validation.md` against an isolated
  `GITHUB_RELEASE_CHANNEL=draft` staging deployment before promotion.

## Signature chain

This section traces the desktop update signature chain end to end —
**manifest → installer → on-disk binary** — and records which release-time
gate enforces each link. Setup for the credentials referenced here lives in
[`MACOS_SIGNING.md`](./MACOS_SIGNING.md) and
[`WINDOWS_SIGNING.md`](./WINDOWS_SIGNING.md).

### macOS (Squirrel.Mac / Developer ID + notarization)

1. **Manifest** — `GET /update/darwin/<version>` on the
   `updates.linguacode.dev` Cloudflare Worker returns the Squirrel.Mac JSON
   `{ url, name, notes, pub_date }`, where `url` is a time-limited signed
   GitHub asset URL served over HTTPS. The worker resolves the asset by the
   filename contract in `update-server/src/darwinAsset.ts`
   (`Lingua-darwin-<arch>-<version>.zip`, legacy `lingua-<version>-darwin-<arch>.zip`
   also accepted). An asset it cannot match yields `204`, which Squirrel.Mac
   reads as "up to date" — so a name drift silently strands auto-update.
2. **Installer / ZIP** — `electron-forge` `MakerZIP` produces the darwin ZIP
   wrapping `Lingua.app`, which `@electron/osx-sign` signs with the Developer
   ID Application identity (hardened runtime) and `@electron/notarize` submits
   to Apple `notarytool`; the notarization ticket is stapled to the bundle.
3. **On-disk binary** — on update, Squirrel.Mac requires the downloaded app to
   carry the **same Developer ID** code signature as the installed app, and
   macOS Gatekeeper validates the signature + stapled notarization ticket
   before first launch.

Release-time gates (in `.github/workflows/release.yml` `build-macos`, all
fail-closed — a non-zero exit aborts before `publish`):

- `Validate macOS signing inputs` — hard-fails the job if any Apple secret is
  missing, so a macOS release is always signed **and** notarized.
- `Assert darwin update-asset name` — runs `scripts/assert-darwin-update-asset.mjs`,
  which asserts every built darwin `.zip` matches the feed contract for the
  release version (the `scripts/lib/darwinAsset.mjs` twin of the worker
  matcher; `tests/scripts/darwinAsset.test.ts` pins the two byte-equivalent).
- `Verify macOS signing` — `codesign --verify --deep --strict`.
- `Verify macOS notarization` — `xcrun stapler validate` (deterministic) plus
  `spctl --assess --type execute` (Gatekeeper acceptance).

### Windows (Squirrel.Windows / Authenticode + RELEASES integrity)

1. **Manifest** — `GET /update/win32/<version>` returns the Squirrel
   `RELEASES` file with each `nupkg` filename rewritten through the worker's
   `/download/<assetId>/<name>` proxy (private-repo assets are not public).
2. **Installer** — `MakerSquirrel` produces `LinguaSetup.exe` + the `nupkg`,
   Authenticode-signed when `WIN_CERT_FILE` / `WIN_CERT_PASSWORD` are present.
3. **Update payload integrity** — Squirrel.Windows consumes the `SHA1`,
   filename, and filesize entries from `RELEASES` when downloading update
   packages. Do **not** treat this as a proven runtime Authenticode verification
   boundary: the release gate verifies the generated Windows executables are
   signed before publish, while the update feed itself remains protected by
   HTTPS, GitHub signed asset URLs, and the `RELEASES` hash/size contract.

Release-time gate: `build-windows` → `Verify Windows signing` runs
`Get-AuthenticodeSignature` and fails closed unless `Status -eq 'Valid'`.

### Linux (deb / rpm)

Linux packages are **not code-signed** and have **no Squirrel auto-update
feed** — Electron's built-in updater is macOS/Windows only. Integrity is
provided by `SHA256SUMS.txt` (generated and re-verified in `publish`). The
`Assert Linux packages are checksummed` gate confirms a selected Linux build
actually contributed `.deb` + `.rpm` entries to the manifest.

### Decision: manifest-signing layer (Ed25519 over the feed JSON)

**Deferred.** The user-protecting integrity checks currently sit below the feed
JSON rather than inside it: macOS rejects an update that is not signed with
Lingua's Developer ID and notarized by Apple, while Windows release artifacts
are Authenticode-verified before publish and Squirrel.Windows consumes the
`RELEASES` hash/size entries while applying updates. The feed is HTTPS end to
end (Worker + signed GitHub asset URL), so a network MITM cannot rewrite it.
An Ed25519 signature over the manifest would add defense-in-depth against a
compromised feed *origin* (the Worker or its `GITHUB_TOKEN`), but it is not the
next shipping blocker while release credentials, publish gates, and update-feed
validation remain private/control-plane protected.

Revisit this decision when **any** of the following becomes true:

- Update binaries are served from a non-GitHub origin that does not carry
  per-asset code signatures / notarization (e.g. a self-hosted byte mirror).
- A new target platform's updater does not verify a code signature on the
  downloaded artifact.
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

### License-signing key rotation (RL-143)

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
their next `/licenses/status` call (or ride the 24h offline grace window per
the internal licensing ADR Decision 4). Tokens that never re-sync (offline/lifetime
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

### Production dependency audit gate (RL-145)

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
   tracking entry in the internal backlog. Never weaken the default `high`
   threshold in CI without that paper trail. `critical` production advisories
   remain release-blocking under this procedure; they need a patched dependency
   or a separate maintainer-approved incident exception.

## Public Documentation Claims

- Confirm README, LICENSE, SECURITY, PRIVACY, press-kit, and release notes all
  describe the same source-available commercial posture.
- Confirm no Markdown file contains machine-local absolute links.
- Confirm no doc claims a checkout, download, plugin ecosystem, or hosted
  feature that is not live.
