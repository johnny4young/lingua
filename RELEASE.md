# Release Checklist

This repository uses a draft-first manual release process, with the release tag created by the workflow from `main`. The checklist below is the human procedure that complements the automation — every step is required before a build leaves the draft state. RL-016 tracks the acceptance around this checklist.

## Preconditions

- CI is green on `main`
- No open P0 incidents in `docs/PLAN.md`
- Release tag will be a stable tag in the form `vX.Y.Z`
- `package.json` `version` and `docs/CHANGELOG.md` have both been bumped to the target version in a merged commit
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
- Apple Developer signing and notarization credentials are still valid
- Windows code-signing certificate is still valid

## Release steps

1. Update versioned product changes in the repository as needed (final doc sweep, `docs/CHANGELOG.md`, any release-gated copy).
2. Commit and merge the release-ready state into `main`.
3. Open GitHub Actions and run the `Release` workflow manually.
4. Provide `release_tag`, the stable tag/version to create and publish, for example `vX.Y.Z`.
5. Wait for the `Release` GitHub Actions workflow to complete.
6. Inspect the workflow summary:
   - Production dependency audit (release-blocking `npm audit --omit=dev --audit-level=high`)
   - macOS signing verification
   - Windows signing verification
   - generated checksums
   - re-verified checksums (`shasum -c SHA256SUMS.txt`)
7. Open the draft GitHub Release created by the workflow.
8. Verify attached artifacts and `SHA256SUMS.txt`.
9. Verify release notes and artifact naming.
10. Download the macOS artifact locally and run `npm run smoke:desktop` against the packaged app (the validated host). The smoke exercises JS, TS, Python, Go, and Rust in the real desktop shell.
11. Confirm the smoke artifacts under `output/playwright/desktop-smoke` captured a screenshot + console log for each runner with zero unexpected errors.
12. Promote the draft release manually when validation is complete.
13. Immediately after promotion, run a **post-publish smoke**: from a clean install location, download the published artifact through the update channel (or the GitHub release page), launch, and confirm the app opens to the default tab without errors.
14. Announce the release (changelog link + download link). Do not announce before post-publish smoke passes.

## Validation checklist

- Release-blocking production dependency audit passed (`npm audit --omit=dev --audit-level=high` in the `security-audit` job); the same job also prints full dependency audit output as advisory signal for build-tool drift
- macOS build completed
- Windows build completed
- Linux build completed
- macOS signing verification passed
- Windows signing verification passed
- `SHA256SUMS.txt` is attached or present in the release payload
- `SHA256SUMS.txt` re-verified against the downloaded payload during `publish` (`shasum -a 256 -c SHA256SUMS.txt`)
- `npm run smoke:desktop` passed against the packaged macOS artifact (the smoke:desktop gate)
- Post-publish smoke succeeded against the channel-distributed artifact
- Release remains draft until human review is complete

## Rollback plan

- If the desktop smoke or post-publish smoke fails, keep the GitHub Release in **draft** and open a rollback issue. Do not promote.
- If a regression is discovered after promotion, re-draft the release (GitHub: Edit → "Save draft"), publish a `-hotfix` patch tag, and repeat the checklist. The update channel will serve the hotfix on the next client check.
- The update bridge tolerates a skipped version — clients on the broken release move directly to the hotfix without manual intervention.

## Current policy

- Stable channel only
- Draft-first publishing
- macOS artifacts are ZIP-only in the active path
- The checklist above is the acceptance gate for RL-016. Any change to the gate must update this file and `tests/docs/releaseChecklist.test.ts` in the same commit.
