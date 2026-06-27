# Remediation And Validation Record - 2026-05-09

This document records the validation performed after remediating the security
scan findings. It is intentionally command-oriented so future release reviewers
can reproduce the same checks.

Historical note: the command blocks below are the exact validation evidence
from 2026-05-09. Current repo commands use `pnpm` and are documented in
[`DEVELOPMENT.md`](../../DEVELOPMENT.md).

## Current Equivalent Commands

Use this block when repeating the same class of validation against the current
tree. The dated sections below remain unchanged historical evidence from the
2026-05-09 remediation run.

```bash
pnpm test -- --run
pnpm run lint
pnpm exec tsc --noEmit
pnpm run check:i18n
pnpm run check:i18n:copy
(cd license-server && pnpm test)
(cd update-server && pnpm test)
pnpm run build:web
pnpm run preview:web -- --host 127.0.0.1
```

## Remediation Map

| Area | Main files changed | Validation |
| ---- | ------------------ | ---------- |
| Filesystem approvals and exact-file caps | `src/main/ipc/fileSystem.ts`, `src/main/ipc/projectCapabilities.ts`, `src/preload/index.ts`, `src/types.d.ts`, renderer reopen callers | IPC, project capability, store, hook, and web adapter tests |
| Trial/education neutral responses | `license-server/src/handlers/trials.ts`, `license-server/src/handlers/education.ts`, shared license types, renderer services and copy | License-server tests, renderer service tests, license section tests, i18n checks |
| Device-limit atomicity and stale token rejection | `license-server/src/lib/db.ts`, `license-server/src/handlers/licenses.ts` | License-server license tests |
| Darwin update asset selection | `update-server/src/index.ts` | Update-server tests |
| Same-origin web Pyodide | `vite.web.config.mts`, `build/copyRuntimeAssetsPlugin.mts`, `src/web/index.html`, `public/sw.js`, `docs/RUNTIME_ASSETS_ADR.md` | Runtime asset tests, service-worker tests, web build |
| Formatter and Go resource caps | `src/main/formatters.ts`, `src/main/go-compiler.ts`, `src/renderer/runners/go.ts`, `src/renderer/workers/go-worker.ts`, `src/shared/runnerLimits.ts` | Formatter, Go runner, and full repo tests |
| Plugin discovery bounds | `src/main/plugins.ts` | Plugin tests |
| Parser bounds | `src/renderer/utils/markdownPreview.ts`, `src/renderer/utils/htmlToJsx.ts` | Markdown and HTML-to-JSX tests |
| Diagnostic redaction and privacy copy | `src/renderer/utils/redactedErrorReport.ts`, `src/main/crashReporter.ts`, EN/ES locale files | Redacted report tests, i18n checks, web smoke |

## Historical Validation Commands

These commands are the 2026-05-09 evidence. Use the current equivalent block
above for a fresh run on the modern repo.

### Full repository tests

```bash
npm test -- --run
```

Result:

- 246 test files passed.
- 2581 tests passed.
- 2 tests skipped.
- Existing React `act(...)` warnings were printed by component tests; the
  command exited successfully.

### Lint

```bash
npm run lint
```

Result: passed.

### Typecheck

```bash
npx tsc --noEmit
```

Result: passed.

### i18n

```bash
npm run check:i18n
npm run check:i18n:copy
```

Result:

- Locale shape check passed for two languages.
- Renderer copy guard passed for touched renderer files.

### License server

```bash
npm --prefix license-server test
```

Result:

- 14 test files passed.
- 205 tests passed.

### Update server

```bash
npm --prefix update-server test
```

Result:

- 3 test files passed.
- 65 tests passed.

### Web build

```bash
npm run build:web
```

Result: passed.

Observed warning:

- Rollup removed an uninterpretable annotation comment from
  `node_modules/terser/lib/parse.js`. This warning came from a third-party
  dependency and did not fail the build.

## UI Smoke

Command:

```bash
npm run preview:web -- --host 127.0.0.1
```

Smoke steps:

1. Opened `http://127.0.0.1:4173/`.
2. Confirmed the Lingua shell rendered.
3. Closed the release/tour overlays when present.
4. Opened Settings.
5. Opened the Account tab.
6. Confirmed the License surface rendered.
7. Confirmed the updated Privacy copy rendered.
8. Read browser console errors.
9. Stopped the preview server.

Result:

- Page title: `Lingua`.
- URL: `http://127.0.0.1:4173/`.
- Account surface visible: yes.
- Privacy copy visible: yes.
- Browser console error count: 0.

## Follow-Up Notes

- The React `act(...)` warnings are not introduced by the security fixes in
  this packet, but they remain useful cleanup work because they can obscure
  future component timing regressions.
- This validation does not replace release signing, packaged desktop smoke, or
  draft auto-update validation. Those remain part of the release security
  checklist.
