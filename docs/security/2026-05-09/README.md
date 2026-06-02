# Security Review Packet - 2026-05-09

Date: 2026-05-09

Scope: full repository security review and remediation record for the hardening
changes landed after the Codex Security scan. This packet documents the analysis
used to fix the findings; it is not a replacement for `SECURITY.md`,
`docs/RELEASE_SECURITY.md`, or the public release checklist.

Historical note: command blocks in this packet are preserved as the validation
evidence from 2026-05-09. Current repo commands use `pnpm`; see
[`DEVELOPMENT.md`](../../DEVELOPMENT.md) and
[`SPRINT-PLAN.md`](../../SPRINT-PLAN.md) for the live validation matrix, and
[`remediation-validation.md`](./remediation-validation.md#current-equivalent-commands)
for the equivalent current command block.

## Documents

| File | Purpose |
| ---- | ------- |
| [`threat-model.md`](./threat-model.md) | Trust boundaries, attack surfaces, and assumptions used to reason about the scan. |
| [`findings.md`](./findings.md) | Finding-by-finding analysis, exploit path, remediation, and validation evidence. |
| [`remediation-validation.md`](./remediation-validation.md) | Command log and UI smoke evidence used to validate the patched tree. |

## Executive Summary

The scan focused on code paths that cross trust boundaries: renderer-to-main
IPC, filesystem grants, native and browser runtimes, license issuance/status
flows, update feeds, plugin discovery, telemetry/crash reporting, and
Markdown/HTML parsing surfaces.

The remediation tightened the highest-risk areas first:

- Filesystem capabilities now distinguish directory grants from exact-file
  grants, and reopen flows require remembered user approval.
- License-server flows avoid account/trial/education enumeration, use
  conditional device-slot writes, and reject stale historical tokens outside a
  short refresh grace window.
- Update-server Darwin assets must match the exact release versioned artifact
  name.
- Pyodide is served as a same-origin runtime asset in web builds instead of a
  third-party CDN cache-first path.
- Formatter, Go, plugin discovery, Markdown preview, and HTML-to-JSX paths now
  enforce resource caps before attacker-controlled payloads can expand.
- Crash/privacy copy and redacted error reports now avoid overclaiming and
  scrub sensitive values from raw exception text.

## Current Equivalent Validation

Use this block when repeating the same class of validation against the current
tree. The dated snapshot below remains the historical 2026-05-09 evidence.

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

## Historical Validation Snapshot

The original security packet was captured before the repo standardized on
`pnpm`, so the commands in this section intentionally remain npm-era evidence.

The patched tree was validated with:

```bash
npm test -- --run
npm run lint
npx tsc --noEmit
npm run check:i18n
npm run check:i18n:copy
npm --prefix license-server test
npm --prefix update-server test
npm run build:web
npm run preview:web -- --host 127.0.0.1
```

The web smoke opened `http://127.0.0.1:4173/`, navigated to
Settings -> Account, confirmed the License and Privacy surfaces rendered, and
checked browser console errors. Result: zero console errors.

See [`remediation-validation.md`](./remediation-validation.md) for the detailed
validation record.
