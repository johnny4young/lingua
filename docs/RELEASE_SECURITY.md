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

The app and `license-server` read `LINGUA_LICENSE_PUBLIC_KEY_JWK` as an ordered
Ed25519 verification keyring. A single JWK remains backward-compatible; during
rotation the value is an array whose first entry is `active` and whose remaining
entries are verification-only `pending` or `retiring` keys. `.env` and
`.env.production` must resolve to the same ordered thumbprints. The Settings
fingerprint shows the first/primary key.

The Worker keeps two private-key slots. `LINGUA_LICENSE_PRIVATE_KEY_JWK` is the
existing `current` slot; `LINGUA_LICENSE_NEXT_PRIVATE_KEY_JWK` is prepared before
rollout. The non-secret `LINGUA_LICENSE_SIGNING_KEY_SLOT` Wrangler var selects
which slot signs new tokens. Never switch the selector until compatible web and
desktop builds accept both public keys.

Public JWKs are stripped to RFC 8037 §2 fields, so they carry no `kid` or issue
date. Rotation metadata lives in
[`security/license-key-registry.json`](./security/license-key-registry.json),
keyed by RFC 7638 thumbprint. Entry states are:

- `active` — first key in the embedded keyring; exactly one.
- `pending` — prepared verification key; its private slot must not sign yet.
- `retiring` — previous signer accepted only during the migration window.
- `retired` — audit trail only; must not remain in a shipped keyring.

**Policy.** The active key rotates at most every `rotationSlaDays` (90). The
guard (`scripts/assert-license-key-rotation.mjs`, alias
`pnpm run check:license-rotation`) fails release, web deploy, and CI on stale,
undocumented, drifted, duplicate, private, oversized, or invalid-status
keyrings. It warns during the final `warnWindowDays` (14).

**Where to read the fingerprint.** The guard prints the active thumbprint; the
running app shows it under **Settings → License → Signing key fingerprint**.
`pnpm run dev:web:pro` / `dev:desktop:pro` print the session key fingerprint in
their launch banner. The production app and guard must match the registry's
`active` entry.

**Rotation procedure (prepare → overlap → promote → retire).** Never overwrite
the active Worker private secret before the overlap release. A direct swap
strands outstanding licenses because old clients and old tokens trust only the
previous key.

1. Inventory production with aggregate-only D1 queries. If any usable licenses
   exist, use every overlap phase below; never assume tokens can be re-issued
   silently.
2. Mint a fresh production keypair with `node scripts/mint-dev-license.mjs`
   (see its doc-comment; use `jq -r`, never `-c`). Upload only the private JWK
   to `LINGUA_LICENSE_NEXT_PRIVATE_KEY_JWK`, then delete the local private file.
3. Append the new public JWK after the active JWK in both `.env` and
   `.env.production`; add its registry row as `pending`. Keep
   `LINGUA_LICENSE_SIGNING_KEY_SLOT = "current"`.
4. Merge and deploy the keyring-aware Worker. Update its
   `LINGUA_LICENSE_PUBLIC_KEY_JWK` secret to the same ordered array. Confirm old
   tokens still pass `/licenses/status`; the Worker must still sign with
   `current`.
5. Deploy web and publish desktop builds containing both verification keys.
   Exercise an old production token on both surfaces. Prove both keyring
   positions with throwaway keys in staging/CI; do not expose or download the
   prepared production private key merely to create a smoke token.
6. Promote in one controlled window:
   - reorder the committed/public-secret keyring to `[new, old]`;
   - mark the new registry entry `active` and the old one `retiring`;
   - change `LINGUA_LICENSE_SIGNING_KEY_SLOT` to `next` and deploy the Worker;
   - run `pnpm run check:license-rotation` and rebuild web/desktop so Settings
     exposes the new active fingerprint.
7. On `/licenses/status`, the Worker detects a token verified by a non-primary
   key, re-signs its canonical D1 row with the selected active private key, and
   returns `refreshedToken`. Compatible clients adopt it; older clients keep
   their still-valid old token until they update.
8. Keep the old public key `retiring` for the announced compatibility window.
   Confirm active-device migration and contact offline/lifetime customers before
   removing it. Old builds can keep using existing old-key tokens during this
   window, but cannot accept newly issued new-key tokens, so publish a minimum
   compatible version before promotion. Then mark the old key `retired` with
   `retiredAt`; never delete registry rows.

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
advisory is caught before merge, not only at release time. Both workflows also
run blocking production audits against the independent
`license-server/pnpm-lock.yaml`, `update-server/pnpm-lock.yaml`, and
`website/package-lock.json` graphs; a clean root lockfile cannot mask a Worker
or website advisory.

**Prod-vs-full split — deliberate, do not "fix".** Only the PRODUCTION graph
is blocking. The dev-inclusive full audit (`pnpm audit --audit-level high`)
stays advisory (`continue-on-error: true`): its remaining `high`/`critical`
findings are dev-only tooling paths: `tar@6` is held by Electron Forge's
rebuild stack, while `sharp@0.34` is held by Wrangler/Miniflare. The patched
`tar` line is a new major, and Miniflare currently pins `sharp` below its
patched line exactly; neither should be forced across its parent toolchain
without cross-platform validation. These paths do not ship in the packaged
artifact. Re-check them on Electron Forge and Wrangler upgrades. Making the
full audit blocking would
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
