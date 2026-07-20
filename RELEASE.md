# Release checklist

Lingua uses a draft-first manual release process. The workflow creates the tag
from `main`, builds every selected surface, and uploads desktop artifacts to a
draft GitHub Release. GitHub Releases is the canonical desktop download and
auto-update source. Cloudflare R2 stores only oversized web runtimes.

## Preconditions

- CI is green on `main`.
- `pnpm run release:preflight` passes locally.
- `package.json` and [`CHANGELOG.md`](./CHANGELOG.md) contain the target version.
- The target is a stable `vX.Y.Z` tag and there are no open release-blocking incidents.
- Cloudflare Pages and R2 web-runtime credentials are configured:
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, and `R2_PUBLIC_BASE`.
- macOS signing/notarization is configured according to
  [`docs/MACOS_SIGNING.md`](./docs/MACOS_SIGNING.md).
- Windows signing is configured according to
  [`docs/WINDOWS_SIGNING.md`](./docs/WINDOWS_SIGNING.md), or the maintainer has
  explicitly accepted an unsigned preview installer and its SmartScreen warning.
- [`docs/RELEASE_SECURITY.md`](./docs/RELEASE_SECURITY.md) has been reviewed for
  the candidate's Electron, IPC, runtime, update, licensing, telemetry, and
  dependency surfaces.

## Release steps

1. Run `pnpm run changelog:draft`, finish the release notes, and run
   `pnpm run changelog:check`.
2. Merge the release-ready state into `main`.
3. Dispatch the `Release` workflow with the target `release_tag`.
4. For a stable desktop release, leave macOS, Windows, and Linux enabled. A
   partial platform selection is for draft diagnostics only.
5. Wait for every selected build and the web deploy to complete.
6. Inspect the workflow summary and artifacts:
   - production dependency audit, license-key policy, and compliance artifacts;
   - macOS arm64 + x64 dmg/zip outputs and the architecture-correct packaged smoke;
   - Windows NSIS structure, `latest.yml`, blockmap, GitHub updater provider,
     and explicit Authenticode state;
   - Linux AppImage and `latest-linux.yml`;
   - `SHA256SUMS.txt`, SBOM, and third-party license report;
   - Cloudflare web deployment and R2 web-runtime readiness.
7. Open the draft GitHub Release and confirm that every enabled platform is
   represented. The website reads these public GitHub assets directly.
8. Follow [`docs/runbooks/desktop-update-draft-validation.md`](./docs/runbooks/desktop-update-draft-validation.md)
   for static draft checks and manual candidate installation.
9. Promote the draft only after the checklist is complete.
10. Run a post-publish smoke from the previous stable desktop version on every
    supported updater platform, and verify `https://updates.linguacode.dev/web/version`.
11. Announce only after the post-publish smoke passes.

## Validation checklist

- `pnpm run release:preflight` passed.
- `pnpm run smoke:desktop` passed before release dispatch; the packaged macOS
  subset passed again against the produced host-native app.
- R2 web-runtime assets passed public-access and CORS probes via
  `pnpm run check:release-infra`.
- macOS arm64 and x64 artifacts are present; the packaged smoke launched the
  host-native app, not an Intel build under Rosetta.
- Windows contains exactly one top-level NSIS `.exe`, its `.blockmap`, and a
  `latest.yml` that references it.
- `win-unpacked/lingua.exe`, `resources/app.asar`, and
  `resources/app-update.yml` passed the Windows structure validator.
- Windows Authenticode is `Valid` when signing secrets are configured. If the
  installer is unsigned, the workflow summary says so and the release is
  treated as preview-quality for Windows.
- Linux AppImage and `latest-linux.yml` are present.
- GitHub Release includes the matching `latest-mac.yml`, `latest.yml`, and
  `latest-linux.yml` manifests for enabled platforms.
- `SHA256SUMS.txt`, `lingua-sbom.cyclonedx.json`, and
  `THIRD_PARTY_LICENSE_REPORT.md` are attached.
- The website release page exposes GitHub download URLs for every published platform.
- Post-publish install/update smoke passed on the supported target machines.
- The release remains draft until human review is complete.

## Rollback plan

- Before promotion, keep the release draft and replace its artifacts only after
  the failing platform gate is green.
- After promotion, remove a broken release from the public channel and publish
  a higher patch version. Clients skip directly to the next valid GitHub Release.
- Follow [`docs/runbooks/update-rollback.md`](./docs/runbooks/update-rollback.md)
  for the operator sequence and customer communication.

## Current policy

- Stable channel, draft-first publishing.
- macOS: arm64 + x64 dmg for installation and zip for auto-update.
- Windows: x64 NSIS `.exe`; unsigned distribution is allowed as an explicitly
  labeled preview until Authenticode credentials are configured.
- Linux: x64 AppImage.
- GitHub Releases owns desktop binaries and updater manifests.
- R2 owns only versioned web runtimes under `web-runtime/`.
- This file and `tests/docs/releaseChecklist.test.ts` are the acceptance gate
  for release-process changes.
