# Performance budgets

Lingua tracks performance as an engineering/release surface, not as a
user-facing app panel. The current gate is intentionally dev/CI only:

- `npm run performance:report` prints a table and writes
  `output/performance/performance-report.{json,md}`.
- `npm run check:performance` compares the current build against
  `docs/performance/baseline.json` and exits non-zero on budget
  violations.
- `npm run performance:baseline` refreshes the committed baseline from
  the build outputs currently on disk.

## What is measured

The report reads the Vite output for the web build and, when present,
the desktop renderer output under `.vite/renderer/main_window`.

Assets are grouped into:

- `initial` — scripts, styles, and modulepreloads referenced directly
  by `index.html`.
- `runtime` — Pyodide, WASM, and zipped runtime assets.
- `worker` — Monaco and runner worker chunks.
- `utility` — known heavy Developer Utilities dependencies such as
  Markdown, HTML, PostCSS, Babel, TypeScript, and hashing chunks.
- `lazy` — other lazy JS/CSS chunks.
- `other` — manifests, icons, fonts, and uncategorized files.

Desktop smoke also writes
`output/playwright/desktop-smoke/desktop-smoke-performance.json` with:

- first JavaScript, TypeScript, and Python run timings;
- total smoke wall-clock duration;
- memory snapshots before the smoke cases and after each case.

Memory data is diagnostic. Platforms that cannot expose the metric
return `unsupported` instead of failing the smoke.

## Budget policy

The baseline stores current measurements plus conservative headroom:

- `initial`: baseline + 10%
- `lazy`: baseline + 15%
- `utility`: baseline + 15%
- `worker`: baseline + 10%
- `runtime`: strict; change only when the runtime asset version changes
- `other`: baseline + 10%

Normal CI runs `npm run performance:report` after `npm run build:web` so
reviewers can see the table in logs, then runs `npm run check:performance`
as the explicit blocking budget gate for build outputs that exist on disk.
A strict release/local check can require every baseline target with:

```bash
node ./scripts/performance-report.mjs --check --require-all-targets
```

## Refreshing the baseline

Refresh the baseline only when a reviewed feature intentionally changes
bundle/runtime size.

```bash
npm run build:web
npm run smoke:desktop
npm run performance:baseline
npm run check:performance
```

`performance:baseline` requires every versioned target to exist so a
web-only refresh cannot accidentally delete desktop renderer budgets.
Use `performance:report` for a non-mutating web-only report; it still
marks the desktop renderer as unavailable when that build output is not
present.

## Investigating regressions

1. Run `npm run performance:report`.
2. Open `output/performance/performance-report.md`.
3. Check the largest-assets list for the category that regressed.
4. Confirm whether the file moved into `initial`; Pyodide and
   Developer Utilities chunks should not become initial assets.
5. If the increase is intentional, document the reason in the ticket
   closeout before refreshing `docs/performance/baseline.json`.

## Manual test

1. Run `npm run build:web`.
2. Run `npm run performance:report`.
3. Confirm the terminal shows a table with initial bundles, lazy
   chunks, workers, runtime assets, and utilities.
4. Open `output/performance/performance-report.json` and confirm it
   contains `generatedAt`, `budgets`, `measurements`, and `violations`.
5. Run `npm run check:performance` and confirm it passes against the
   committed baseline.
6. Run `npm run smoke:desktop`.
7. Open `output/playwright/desktop-smoke/desktop-smoke-performance.json`
   and confirm it includes JS, TS, Python timings and memory snapshots
   or an `unsupported` memory result.
8. Confirm Pyodide and Developer Utilities assets are not listed as
   `initial` in the performance report.
9. Confirm the report is readable from terminal or CI logs without
   opening Lingua.
