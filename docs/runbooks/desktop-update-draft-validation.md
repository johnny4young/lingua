# Runbook — desktop update candidate validation

**Severity:** release-blocking.
**Owner:** maintainer.
**Related:** `RELEASE.md`, `electron-builder.yml`, `src/main/updater.ts`,
`docs/MACOS_SIGNING.md`, `docs/WINDOWS_SIGNING.md`.

## Architecture

Packaged desktop apps use `electron-updater` with the GitHub provider embedded
in `resources/app-update.yml`. GitHub Releases hosts both the installers and
the `latest*.yml` manifests. `updates.linguacode.dev` is not the desktop binary
feed; its `/web/version` route serves the browser update banner.

GitHub does not expose a draft Release as the stable updater channel. Draft
validation is therefore static plus manual installation. The real previous →
current auto-update smoke happens immediately after promotion.

## Draft checks

1. Keep the candidate GitHub Release in draft.
2. Confirm the workflow validated:
   - `latest-mac.yml` references the arm64 and x64 zip assets;
   - `latest.yml` references the Windows NSIS installer and its blockmap;
   - `latest-linux.yml` references the AppImage;
   - each packaged app embeds `provider: github`, owner `johnny4young`, repo `lingua`.
3. Install the candidate manually on each selected target and launch it.
4. Exercise Settings → Updates, one native runtime, and one bundled offline runtime.
5. Save workflow logs and screenshots with the release evidence.

An unsigned Windows candidate may be exercised as a preview, but the evidence
must record the expected SmartScreen warning. When signing secrets are present,
`Get-AuthenticodeSignature` must report `Valid`.

## Post-publish updater smoke

1. Start from the previous stable version on macOS arm64, macOS x64, and
   Windows x64 when those platforms are published.
2. Publish the candidate.
3. Trigger Settings → Updates or wait for the scheduled check.
4. Confirm checking → available → downloaded → restart.
5. Confirm the relaunched app reports the new version and architecture.
6. Verify `https://updates.linguacode.dev/web/version` reports the same version.

If any platform cannot update, stop announcements and follow
[`update-rollback.md`](./update-rollback.md).
