# Release Checklist

This repository uses a draft-first manual release process, with the release tag created by the workflow from `main`. The checklist below is the human procedure that complements the automation — every step is required before a build leaves the draft state. RL-016 tracks the acceptance around this checklist.

## Preconditions

- CI is green on `main`
- No open P0 incidents in `docs/PLAN.md`
- Release tag will be a stable tag in the form `vX.Y.Z`
- `package.json` `version` and root [`CHANGELOG.md`](./CHANGELOG.md) have both been bumped to the target version in a merged commit
- GitHub Actions secrets are configured:
  - macOS:
    - `APPLE_ID`
    - `APPLE_ID_PASSWORD`
    - `APPLE_TEAM_ID`
    - `APPLE_SIGNING_IDENTITY`
    - `APPLE_CERT_P12_BASE64`
    - `APPLE_CERT_PASSWORD`
  - Windows:
    - `WIN_CERT_FILE`
    - `WIN_CERT_PASSWORD`
  - Cloudflare web deploy:
    - `CLOUDFLARE_API_TOKEN`
    - `CLOUDFLARE_ACCOUNT_ID`
    - `CLOUDFLARE_ZONE_ID` (optional; cache purge only)
  - Cloudflare R2 release mirror (private-repo download surface — see [`docs/runbooks/r2-release-mirror-setup.md`](./docs/runbooks/r2-release-mirror-setup.md)):
    - `R2_ACCESS_KEY_ID`
    - `R2_SECRET_ACCESS_KEY`
    - `R2_ENDPOINT`
    - `R2_PUBLIC_BASE`
- Apple Developer signing and notarization credentials are still valid
- macOS signing setup has been checked against
  [`docs/MACOS_SIGNING.md`](./docs/MACOS_SIGNING.md)
- Windows code-signing setup has been checked against
  [`docs/WINDOWS_SIGNING.md`](./docs/WINDOWS_SIGNING.md)

## Release steps

1. Draft release notes with `pnpm run changelog:draft`, then update versioned product changes in the repository as needed (final doc sweep, root `CHANGELOG.md`, any release-gated copy). Run `pnpm run changelog:check` before merging the release-ready state.
2. Commit and merge the release-ready state into `main`.
3. Open GitHub Actions and run the `Release` workflow manually.
4. Provide `release_tag`, the stable tag/version to create and publish, for example `vX.Y.Z`.
5. Wait for the `Release` GitHub Actions workflow to complete.
6. Inspect the workflow summary:
   - Production dependency audit (release-blocking `pnpm audit --prod --audit-level high`)
   - Changelog/version guard with exact release-tag validation
   - Third-party license policy and release compliance artifact generation
   - macOS signing verification
   - Packaged desktop smoke (RL-080 Slice 3 — release-blocking offline 2-runtime-case subset against the produced `Lingua.app`)
   - Windows signing verification
   - Linux package validation (`linux-package-validation` artifact with Debian install smoke + RPM metadata)
   - Desktop update feed validation (`check:update-feed` evidence for any macOS/Windows release)
   - generated checksums
   - re-verified checksums (`node ./scripts/prepare-release-payload.mjs --root out/make --verify-checksums`)
   - Cloudflare deploy validation artifact for web releases
7. Open the draft GitHub Release created by the workflow.
8. Verify attached artifacts, `SHA256SUMS.txt`, `lingua-sbom.cyclonedx.json`, and `THIRD_PARTY_LICENSE_REPORT.md`.
9. Verify release notes and artifact naming.
10. CI already runs the **packaged desktop smoke** against the macOS `.app` inside the `build-macos` job (the `Packaged desktop smoke` step, RL-080 Slice 3). It is a **release-blocking offline** 2-runtime-case subset (javascript + python, plus the no-CDN assertion) that proves the binary boots, the renderer chunks load, and the vendored Pyodide runtime works offline. The full 9-case matrix (JS, TS, Python, Go, Rust + the RL-078 timeout cases + the RL-079 env-isolation cases) still runs against the dev server in `pnpm run smoke:desktop` as part of pre-merge CI. Optionally, download the macOS artifact locally and run `pnpm run smoke:desktop` for a sanity check against the dev server, or `pnpm run smoke:desktop:packaged` for the same packaged subset CI ran.
11. Confirm the workflow summary lists the packaged smoke as `passed`. Optional: if you ran a local smoke, confirm the artifacts under `output/playwright/desktop-smoke` captured a screenshot + console log for each runner with zero unexpected errors.
12. Before promotion, run the desktop update draft validation runbook for any selected macOS/Windows release: [`docs/runbooks/desktop-update-draft-validation.md`](./docs/runbooks/desktop-update-draft-validation.md). Attach or archive `output/update-feed-validation/update-feed-validation.json` with the release evidence.
13. Confirm the **R2 release mirror** is in sync. The `mirror-r2` job runs automatically after `publish` and validates itself via `check:r2-mirror`. Re-run locally if the workflow summary surfaces a skip / warning: `pnpm run check:r2-mirror -- --release-tag vX.Y.Z`. Attach or archive `output/r2-mirror-validation/<tag>.json` with the release evidence. Marketing-site download CTAs (separate repo `lingua-marketing`) depend on this mirror; if it is skipped the public download links will 404. Full setup in [`docs/runbooks/r2-release-mirror-setup.md`](./docs/runbooks/r2-release-mirror-setup.md).
14. Promote the draft release manually when validation is complete.
15. Immediately after promotion, run a **post-publish smoke**: from a clean install location, download the published artifact through the update channel (or the GitHub release page), launch, and confirm the app opens to the default tab without errors.
16. Announce the release (changelog link + download link). Do not announce before post-publish smoke passes.

## Validation checklist

- Release-blocking production dependency audit passed (`pnpm audit --prod --audit-level high` in the `security-audit` job); the same job also prints full dependency audit output as advisory signal for build-tool drift
- Changelog/version guard passed (`pnpm run changelog:check`)
- Performance budget guard passed (`pnpm run check:performance`)
- Third-party license policy passed (`pnpm run check:licenses`)
- Release compliance artifacts generated (`pnpm run compliance:release`)
- Release security checklist completed (`docs/RELEASE_SECURITY.md`)
- macOS build completed
- Windows build completed
- Linux build completed
- Linux package validation artifact `linux-package-validation` is attached to the workflow run and records Debian metadata, RPM metadata, Debian install, packaged launch smoke, and uninstall verification
- macOS signing verification passed
- Windows signing verification passed
- `SHA256SUMS.txt` is attached or present in the release payload
- `SHA256SUMS.txt` re-verified against the downloaded payload during `publish` (`node ./scripts/prepare-release-payload.mjs --root out/make --verify-checksums`)
- `lingua-sbom.cyclonedx.json` is attached or present in the release payload
- `THIRD_PARTY_LICENSE_REPORT.md` is attached or present in the release payload
- Packaged desktop smoke passed in CI (the `Packaged desktop smoke` step in `build-macos`, RL-080 Slice 3 — release-blocking offline, 2-runtime-case subset against the actual `.app`)
- `pnpm run smoke:desktop` passed against the dev server in pre-merge CI (the existing 9-case matrix gate)
- For macOS/Windows releases, `pnpm run check:update-feed -- --base-url <staging-updates> --old-version <previous> --expected-version <target>` passed against the draft-channel staging feed and wrote `output/update-feed-validation/update-feed-validation.json`
- Post-publish smoke succeeded against the channel-distributed artifact
- Web release artifact `cloudflare-deploy-validation` is attached to the workflow run and records the Wrangler deploy log, `app.linguacode.dev` app-shell check, service-worker update-endpoint bypass, and `updates.linguacode.dev/web/version` response
- R2 release mirror artifact `r2-mirror-validation` is attached to the workflow run and records the per-asset parity check between the draft GitHub Release and the public mirror at `downloads.linguacode.dev` (`check:r2-mirror`). Marketing-site download CTAs in the separate `lingua-marketing` repo point at this mirror — a skipped/failed mirror means the public download links are stale or broken.
- Release remains draft until human review is complete
- macOS signing and notarization evidence is attached or visible in the
  workflow logs for any macOS artifact
- Windows Authenticode signing evidence is attached or visible in the workflow
  logs for any Windows artifact

## Rollback plan

- If the desktop smoke or post-publish smoke fails, keep the GitHub Release in **draft** and open a rollback issue. Do not promote.
- If a regression is discovered after promotion, re-draft the release (GitHub: Edit → "Save draft"), publish a `-hotfix` patch tag, and repeat the checklist. The update channel will serve the hotfix on the next client check.
- The update bridge tolerates a skipped version — clients on the broken release move directly to the hotfix without manual intervention.

## Current policy

- Stable channel only
- Draft-first publishing
- macOS artifacts are ZIP-only in the active path
- The checklist above is the acceptance gate for RL-016. Any change to the gate must update this file and `tests/docs/releaseChecklist.test.ts` in the same commit.
- Marketing site at [linguacode.dev](https://linguacode.dev) lives in a separate repo (`johnny4young/lingua-marketing`) with an independent deploy cadence; see [`docs/MARKETING_SITE_ADR.md`](./docs/MARKETING_SITE_ADR.md). Releases of this repo do not redeploy the marketing site, and content fixes there do not require a release tag here.
