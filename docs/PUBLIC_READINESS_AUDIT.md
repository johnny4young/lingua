# Public readiness audit

Date: 2026-05-07

Scope: repository publication, release CI, desktop auto-update, Cloudflare
operations, changelog/version hygiene, security posture, performance gates,
documentation drift, and source-available licensing claims.

This audit is a repo-grounded readiness snapshot. It does not rewrite history,
force-push tags, change the source-available commercial license posture, or
enable public macOS/Windows release jobs before signing credentials exist.

## Executive summary

Lingua is close to public-source readiness, but it should not be treated as a
fully public desktop release channel until the remaining signing and history
gates are cleared. The web build and Linux packaging are the lowest-risk
release paths. macOS and Windows should stay preflight-only until signing
secrets are configured and a packaged smoke passes against signed artifacts.

Highest-priority current actions:

1. Keep version, tags, and `CHANGELOG.md` synchronized before the next tag.
2. Keep local agent skills out of the public repository while preserving the
   maintainer's local commands.
3. Run a full-history Gitleaks scan before changing repository visibility.
4. Validate auto-update end-to-end against a draft release before promoting a
   public desktop release.
5. Resolve product-tier copy drift between `docs/LICENSING_ADR.md` and older
   launch collateral before the next marketing update.

## Current state

| Area                 | Evidence                                                                                                                                                                                                                                  | Status                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Versioning           | `package.json` was behind `v0.2.3`; the readiness pass moved the working tree to `0.2.4` and added changelog entries for `0.2.2`, `0.2.3`, and `0.2.4`.                                                                                   | Improved                        |
| Release CI           | `.github/workflows/release.yml` has draft-first release, selected-platform success gates, production audit, checksum verification, SBOM, Linux package validation, and signing preflights.                                                | Good, credential-gated          |
| CI performance       | CI prints `performance:report`, runs `check:performance` after `build:web`, and the report now folds in desktop smoke runtime observability when that artifact exists.                                                                     | Good                            |
| Auto-update          | `src/main/updater.ts` checks on launch and then every one hour for `darwin` and `win32`. Electron's built-in updater does not support Linux.                                                                                              | Good, docs drift fixed          |
| Cloudflare           | `update-server/` serves update feeds and `/web/version`; web deploy uses Cloudflare Pages through Wrangler; deploy workflow now uploads a `cloudflare-deploy-validation` artifact with Wrangler logs and live app/update endpoint checks. | Good                            |
| Security docs        | `SECURITY.md`, `PRIVACY.md`, `docs/RELEASE_SECURITY.md`, and public checklist exist.                                                                                                                                                      | Good                            |
| Secrets              | `.env.production` contains public build-time values only. Production private keys and signing material are expected as GitHub/Cloudflare secrets.                                                                                         | Good, pending full-history scan |
| Local skills         | `.agents/skills/lingua-review` and `.agents/skills/lingua-ship` were tracked; the readiness pass ignores and untracks them while leaving local files available.                                                                           | Improved                        |
| Changelog automation | Draft/check scripts exist, CI runs `changelog:check`, and the release workflow requires the requested tag to match `package.json` and the top `CHANGELOG.md` release entry before publishing starts.                                      | Good                            |
| License posture      | Source-available commercial; do not describe as open source.                                                                                                                                                                              | Good                            |

## Findings

### P0 — release blockers

No current P0 source blocker was found in the inspected repo state. A public
binary release can still be blocked operationally by missing signing secrets;
that is expected and should remain a fail-fast release preflight.

### P1 — must close before public repo visibility or public desktop release

**P1-1 — Full-history secret scan is required before visibility changes.**

Current-tree checks are not enough because previous private commits can still
become public. Run:

```bash
go run github.com/zricethezav/gitleaks/v8@latest git --no-banner --redact .
```

Any production secret found in history must be rotated even if history is later
rewritten before publication.

**P1-2 — macOS and Windows releases must remain signing-gated.**

The release workflow expects macOS Developer ID notarization secrets and Windows
certificate secrets. Electron's `autoUpdater` supports macOS and Windows; the
official Electron docs also require signing for macOS automatic updates. Do not
promote macOS/Windows artifacts until signing verification and packaged smoke
both pass.

**P1-3 — Auto-update needs an end-to-end draft-release validation.**

Unit/workflow coverage proves the feed contract, but a real update cycle still
needs a draft release with signed artifacts, `updates.linguacode.dev` feed
checks, install, update, and rollback validation.

**P1-4 — Product-tier copy drift in older launch collateral.**

`docs/LICENSING_ADR.md` defines the current public copy as Free, Monthly, Pro,
and Education. Resolved on 2026-05-07 by aligning README, LICENSE, press kit,
SEO page scaffolds, renderer tier labels, email labels, and guard tests while
leaving legacy backend slugs intact for token compatibility.

### P2 — should close during public launch hardening

**P2-1 — Changelog discipline needs to become part of every release branch.**

Resolved on 2026-05-07. CI now runs `npm run changelog:check` after the
i18n copy guard, and the release workflow runs
`npm run changelog:check -- --release-tag "${RELEASE_TAG}" --from "${RELEASE_TAG}"`
inside the release-blocking audit job. The script also validates that the
requested release tag exactly matches `package.json` and the top `CHANGELOG.md`
release heading.

**P2-2 — Cloudflare deploy validation should be recorded per release.**

Resolved on 2026-05-07. The reusable `deploy-web` workflow now records
`wrangler pages deploy` output, validates `https://app.linguacode.dev/`,
validates the deployed service worker still bypasses
`updates.linguacode.dev`, validates `https://updates.linguacode.dev/web/version`
returns either `200` with semver JSON or `204` when no published release exists,
and uploads the evidence as the `cloudflare-deploy-validation` artifact.

**P2-3 — Linux should be validated first.**

Resolved on 2026-05-07. Linux now has a release-blocking package validation
step after `npm run make:desktop:linux`: the job records Debian metadata, RPM
metadata, installs the `.deb`, launches the installed binary under `xvfb` in
packaged smoke mode, removes the Debian package, verifies the `lingua` binary is
gone, and uploads the evidence as `linux-package-validation`. RPM remains
metadata-validated on Ubuntu because the release runner is not an RPM distro.

**P2-4 — Performance gates should keep startup-focused follow-up work visible.**

Resolved on 2026-05-07. The desktop smoke artifact now records
launcher-to-smoke-ready timing, first editor interaction timing, first run per
language, total smoke wall time, and memory snapshots. `performance:report`
ingests that artifact when present and writes the normalized
`runtimeObservability` section to `output/performance/performance-report.json`
and `output/performance/performance-report.md`; web-only CI reports keep the
section visible as unavailable instead of failing.

### P3 — cleanup before wider contributors arrive

**P3-1 — Complex subsystem docs should be easy to find from the docs index.**

`docs/README.md` now links this audit and the macOS signing guide. Keep future
deep docs linked there instead of creating isolated Markdown files.

**P3-2 — Source-available wording must stay consistent.**

README, press kit, release docs, and license docs should say source-available
commercial, not open source, MIT, Apache, or GPL.

## Release OS matrix

| Target  | Current path                                                   | Public release recommendation                                                        |
| ------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Web     | `npm run build:web` and Cloudflare Pages deploy.               | Validate first; already the lowest-friction public surface.                          |
| Linux   | Electron Forge Deb/RPM makers plus CI package validation.      | Validate after web; no signing secrets needed, but no built-in Electron auto-update. |
| macOS   | Electron Forge ZIP with Developer ID signing and notarization. | Keep blocked until Apple secrets are configured and packaged smoke passes.           |
| Windows | Electron Forge Squirrel maker with Authenticode signing.       | Keep blocked until certificate strategy and signing secrets are configured.          |

Relevant references:

- [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater)
- [Electron Forge macOS signing](https://www.electronforge.io/guides/code-signing/code-signing-macos)
- [Electron Forge Windows signing](https://www.electronforge.io/guides/code-signing/code-signing-windows)
- [Apple Developer ID](https://developer.apple.com/developer-id/)
- [Cloudflare Wrangler Pages commands](https://developers.cloudflare.com/workers/wrangler/commands/pages/)
- [Cloudflare Wrangler Workers commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)

## Auto-update validation plan

1. Build signed macOS/Windows artifacts from a draft tag.
2. Keep the GitHub Release in draft.
3. Confirm `updates.linguacode.dev/update/darwin/<old_version>` and
   `updates.linguacode.dev/update/win32/<old_version>` return update metadata
   for the draft candidate only when the update server is intentionally pointed
   at that release.
4. Install the previous build on a clean machine or VM.
5. Launch, wait for the update check, and confirm the update state transitions
   through available/downloaded.
6. Run `quitAndInstall`, relaunch, and confirm the app version matches the new
   tag.
7. Exercise rollback by removing the bad draft/release from the feed and
   confirming the previous good version is served.

## Changelog workflow

During feature or fix work:

```bash
npm run changelog:draft
npm run changelog:check
```

CI runs `changelog:check` on every push and pull request. Release automation
runs the same guard with `--release-tag` so a workflow input like `v0.2.4`
cannot publish if the package version or top changelog entry still says a
different version.

Commit bodies can opt out of user-facing notes with:

```text
Changelog: none
```

Or provide exact public wording:

```text
Changelog: Added - Profile backups can now be exported and restored.
```

Release owners should still edit `CHANGELOG.md` into product-facing language;
the draft script is an input, not the final release note.

## Source-available publication checklist

Before making the repository public:

1. Run the full validation list in `docs/PUBLIC_RELEASE_CHECKLIST.md`.
2. Run full-history Gitleaks and rotate any exposed production secret.
3. Confirm `.agents/skills/lingua-review` and `.agents/skills/lingua-ship` are
   not tracked.
4. Confirm no generated artifacts, local screenshots, or machine-local absolute
   paths are tracked.
5. Confirm `README.md`, `LICENSE`, `SECURITY.md`, `PRIVACY.md`, and
   `CONTRIBUTING.md` are the intended public surfaces.
6. Confirm release tags and changelog entries match the version to publish.

## Roadmap suggestions

These are not new committed `RL-XXX` tickets yet; graduate only when acceptance
criteria and priority are clear.

- Signed macOS release readiness: complete Developer ID setup, notarization,
  packaged smoke, and auto-update validation.
- Signed Windows release readiness: choose Authenticode certificate strategy,
  verify installer signing, and run update smoke on a Windows VM.
- Auto-update staging channel: test updates against draft or prerelease feeds
  without exposing them to stable users.
- Public security automation: scheduled Gitleaks, dependency audit triage, and
  release-security checklist artifact.
- Startup performance thresholds: turn the observed launch-to-smoke-ready,
  first editor interaction, and first-run language metrics into explicit release
  budgets once a few stable smoke runs establish normal variance.
- Memory leak watch: graduate the current before/after smoke snapshots into
  repeated-run threshold warnings.
- Product growth: AI bridge, HTTP client, SQL playground, GraphQL client,
  local snippet packs, classroom lessons, and a guided recovery UX should be
  evaluated as post-public-launch differentiators.

## Manual test

1. Run `npm run changelog:draft` and confirm a grouped markdown draft appears.
2. Run `npm run changelog:check` and confirm package/changelog/tag drift is not
   reported.
3. Run `npm run build:web`.
4. Run `npm run performance:report`.
5. Confirm `output/performance/performance-report.md` includes Runtime
   Observability, marked unavailable until a desktop smoke artifact exists.
6. Run `npm run check:performance`.
7. Run `npm run check:licenses`.
8. Run `npm run compliance:release`.
9. For web releases, confirm the GitHub Actions run contains the
   `cloudflare-deploy-validation` artifact with the Wrangler log and
   `web-validation.json`.
10. For Linux releases, confirm the GitHub Actions run contains the
   `linux-package-validation` artifact with Debian/RPM metadata,
   packaged smoke output, and uninstall verification.
11. Run full-history Gitleaks before visibility changes.
12. Run `npm run smoke:desktop` before promoting a desktop release branch.
13. Re-run `npm run performance:report` and confirm Runtime Observability is
    populated from `output/playwright/desktop-smoke/desktop-smoke-performance.json`.
