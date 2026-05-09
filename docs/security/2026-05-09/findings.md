# Findings And Remediation Matrix - 2026-05-09

Severity reflects the reviewed pre-fix tree. Status reflects the patched tree.

| ID | Severity | Status | Area |
| -- | -------- | ------ | ---- |
| SEC-001 | High | Fixed | Filesystem reopen root |
| SEC-002 | High | Fixed | Education confirmation id disclosure |
| SEC-003 | Medium | Fixed | Single-file open/save grants |
| SEC-004 | Medium | Fixed | Formatter environment inheritance |
| SEC-005 | Medium | Fixed | Output/artifact caps and Go parent timeout |
| SEC-006 | Medium | Fixed | Device-limit race |
| SEC-007 | Medium | Fixed | Historical token replay |
| SEC-008 | Medium | Fixed | Update server Darwin asset matching |
| SEC-009 | Medium | Fixed | Pyodide CDN cache-first loading |
| SEC-010 | Medium | Fixed | Crash/privacy copy overclaim |
| SEC-011 | Low | Fixed | Trial/education enumeration |
| SEC-012 | Low | Fixed | Plugin discovery resource bounds |
| SEC-013 | Low | Fixed | Redacted report raw `Error.message` |
| SEC-014 | Low | Fixed | Markdown/HTML-to-JSX parser DoS |

## SEC-001 - Filesystem `fs:reopen-root` could reopen arbitrary desktop paths

Attack path:

1. Renderer-controlled or persisted state contains an absolute path.
2. The renderer asks the main process to reopen it as a root.
3. If the main process accepts the path without checking prior user approval,
   stale or injected state can regain filesystem access without a picker.

Remediation:

- `src/main/ipc/fileSystem.ts` now records approved roots and exact files.
- `fs:reopen-root` rejects roots that were not previously approved.
- `src/main/ipc/projectCapabilities.ts` now supports exact-file capabilities
  with `allowedRelativePath`.

Validation:

- `tests/ipc/fileSystem.test.ts`
- `tests/main/projectCapabilities.test.ts`
- `tests/stores/sessionStore.test.ts`
- `tests/hooks/useDeepLinks.test.tsx`

## SEC-002 - Education start leaked a pending confirmation id

Attack path:

1. A client starts an education confirmation flow.
2. The response includes the pending confirmation id.
3. If that id is enough to build or brute-force follow-up state, the client has
   an unnecessary correlation primitive and an account-status signal.

Remediation:

- `license-server/src/handlers/education.ts` no longer returns `pendingId` from
  success or confirmation-email-failed responses.
- `src/shared/licenseServerTypes.ts` removed `pendingId` from
  `EducationStartPending`.

Validation:

- `license-server/test/education.test.ts`
- `tests/services/educationServer.test.ts`
- `tests/components/LicenseSection.test.tsx`

## SEC-003 - Single-file open/save granted parent-directory capabilities

Attack path:

1. A user selects one file through open/save.
2. The app mints a root capability for that file's parent directory.
3. Renderer code can use the same root id plus sibling relative paths to access
   additional files that were not selected.

Remediation:

- `select-file` and `save-dialog` now mint exact-file capabilities via
  `mintFileCapability`.
- `resolveCapabilityPath` rejects any relative path other than the allowed file
  path for file-scoped capabilities.
- Renderer reopen paths use `fs:reopen-file` where the user originally selected
  a file, not a directory.

Validation:

- `tests/ipc/fileSystem.test.ts`
- `tests/main/projectCapabilities.test.ts`
- `tests/web/fs-adapter.test.ts`

## SEC-004 - Formatter subprocesses inherited the full process environment

Attack path:

1. A formatter binary is executed on user-provided text.
2. The process inherits sensitive environment variables from the app process.
3. A malicious or compromised formatter can read or exfiltrate variables that
   are unrelated to formatting.

Remediation:

- `src/main/formatters.ts` now builds formatter subprocess env through the
  native-runner allowlist.
- Formatter version probes and actual formatter runs pass the filtered env.

Validation:

- `tests/main/formatters.test.ts`

## SEC-005 - Runner output/artifact paths lacked parent-owned caps

Attack path:

1. A worker or formatter emits large stdout/stderr or never resolves.
2. Child-side timeout logic can be bypassed if the worker is wedged.
3. Successful oversized output can still pressure memory or UI surfaces.

Remediation:

- Formatter stdout/stderr are capped.
- Go WASM artifacts are size-checked before reading.
- The Go renderer runner now owns timeout/cancel behavior from the parent side,
  tracks `runId`, caps console/stderr payloads, and terminates stale workers.

Validation:

- `tests/main/formatters.test.ts`
- `tests/runners/go.test.ts`

## SEC-006 - Device-limit enforcement had a race window

Attack path:

1. Two activation requests read the same current device count.
2. Both see capacity available.
3. Both insert or reactivate devices, exceeding the license device cap.

Remediation:

- `license-server/src/lib/db.ts` added conditional slot-aware insert/reactivate
  helpers.
- `license-server/src/handlers/licenses.ts` now treats a zero affected row count
  as exhausted.

Validation:

- `license-server/test/licenses.test.ts`
- `license-server/test/helpers.ts`

## SEC-007 - Historical tokens could be replayed too broadly

Attack path:

1. A renewal or replacement token becomes the current persisted token.
2. An older signed token for the same license remains cryptographically valid.
3. A client can keep using stale credentials if the status endpoint accepts old
   payloads indefinitely.

Remediation:

- `license-server/src/handlers/licenses.ts` accepts historical payloads only
  within a short refresh grace window after the payload's support window ends.
- Tokens outside that grace are rejected.

Validation:

- `license-server/test/licenses.test.ts`

## SEC-008 - Darwin update asset matching was too loose

Attack path:

1. A GitHub Release contains multiple `.zip` assets.
2. The update server selects by broad Darwin/ZIP matching.
3. A wrong-version or misleading asset can be returned in the update feed.

Remediation:

- `update-server/src/index.ts` now requires exact release-versioned Darwin
  artifact names:
  `lingua-<version>-darwin-(x64|arm64|universal).zip`.

Validation:

- `update-server/test/index.test.ts`

## SEC-009 - Web Pyodide used third-party CDN cache-first loading

Attack path:

1. Web Python runtime loads Pyodide from `cdn.jsdelivr.net`.
2. The service worker keeps a third-party runtime cache-first branch.
3. A CDN substitution or stale cache can influence the Python runtime.

Remediation:

- `vite.web.config.mts` uses `copyRuntimeAssetsPlugin()`.
- `src/web/index.html` no longer allows jsDelivr in runtime CSP.
- `public/sw.js` removed the Pyodide CDN cache-first path and bumped the cache
  version.
- `docs/RUNTIME_ASSETS_ADR.md` documents same-origin web runtime assets.

Validation:

- `tests/shared/runtimeAssets.test.ts`
- `tests/web/sw.test.ts`
- `npm run build:web`

## SEC-010 - Crash/privacy copy overclaimed what reports exclude

Attack path:

1. UI text claims crash reports exclude sensitive local data.
2. Electron minidumps can contain diagnostic process details outside the app's
   text-level redaction path.
3. Users make consent decisions based on stronger guarantees than the product
   can enforce.

Remediation:

- `src/renderer/i18n/locales/en/common.json` and
  `src/renderer/i18n/locales/es/common.json` now describe telemetry as coarse
  and crash reports as opt-in diagnostic minidumps.
- `src/main/crashReporter.ts` comments were aligned with the actual behavior.

Validation:

- `npm run check:i18n`
- `npm run check:i18n:copy`
- Web smoke in Settings -> Account.

## SEC-011 - Trial and education duplicates revealed account/device status

Attack path:

1. A client submits an email or device id to trial/education endpoints.
2. Duplicate-specific reasons reveal whether the email or device already exists.
3. This can be used for account or device enumeration.

Remediation:

- Trial duplicates now return generic `trial-unavailable`.
- Education duplicates now return generic `education-unavailable`.
- Renderer copy maps the generic reasons to neutral recovery-oriented messages.

Validation:

- `license-server/test/trials.test.ts`
- `license-server/test/education.test.ts`
- `tests/services/trialServer.test.ts`
- `tests/services/educationServer.test.ts`
- `tests/components/LicenseSection.test.tsx`

## SEC-012 - Plugin discovery could scan too many entries or oversized manifests

Attack path:

1. A plugin directory contains many entries or very large manifest files.
2. Discovery reads or parses too much local data.
3. The app can slow down or exhaust resources before validating manifest shape.

Remediation:

- `src/main/plugins.ts` caps scan entries and manifest bytes.
- Non-file manifests and oversized manifests are rejected before reading.

Validation:

- `tests/main/plugins.test.ts`

## SEC-013 - Redacted reports still used raw `Error.message`

Attack path:

1. An exception message includes a bearer token, license-like token, URL query
   parameter, local path, or `file://` URL.
2. The report builder redacts stack text but includes the raw message.
3. Sensitive data leaks through copy/export/reporting surfaces.

Remediation:

- `src/renderer/utils/redactedErrorReport.ts` redacts sensitive text before
  truncating `Error.message`.
- Stack redaction uses the same text redaction helper.

Validation:

- `tests/utils/redactedErrorReport.test.ts`

## SEC-014 - Markdown and HTML-to-JSX parsing could be abused for DoS

Attack path:

1. Input is padded with large whitespace or deeply nested HTML.
2. Caps run after trimming or after expansion, or only check one dimension.
3. Parser or renderer work grows beyond expected resource bounds.

Remediation:

- `src/renderer/utils/markdownPreview.ts` checks the raw source size before
  trimming.
- `src/renderer/utils/htmlToJsx.ts` enforces raw byte, depth, node-count, and
  output-byte caps.

Validation:

- `tests/utils/markdownPreview.test.ts`
- `tests/utils/htmlToJsx.test.ts`
