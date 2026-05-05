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
- Confirm update-server responses do not expose draft or malformed versions.

## Licensing

- Confirm license tokens are never logged in URLs.
- Confirm activation/status/remove-device paths preserve device caps and tagged
  errors.
- Confirm private license-signing keys exist only in secret stores.

## Telemetry And Crash Reporting

- Confirm telemetry and crash reporting are opt-in and kill-switchable.
- Confirm payload redaction excludes code, file paths, env values, license
  tokens, and arbitrary exception payloads.

## Dependencies And Notices

- Confirm `THIRD_PARTY_NOTICES.md` and the generated SBOM/license report are
  current.
- Confirm public builds do not introduce AGPL/commercial runtime dependencies
  without an explicit license decision.
- Confirm no disallowed runtime license ships in packaged artifacts.

## Public Documentation Claims

- Confirm README, LICENSE, SECURITY, PRIVACY, press-kit, and release notes all
  describe the same source-available commercial posture.
- Confirm no Markdown file contains machine-local absolute links.
- Confirm no doc claims a checkout, download, plugin ecosystem, or hosted
  feature that is not live.
