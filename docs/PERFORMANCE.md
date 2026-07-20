# Performance budgets

Lingua tracks performance as an engineering/release surface, not as a
user-facing app panel. The current gate is intentionally dev/CI only:

- `pnpm run performance:report` prints a table and writes
  `output/performance/performance-report.{json,md}`.
- `pnpm run check:performance` compares the current build against
  `docs/performance/baseline.json` and exits non-zero on budget
  violations.
- `pnpm run performance:baseline` refreshes the committed baseline from
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

- launcher-to-smoke-ready timing when the smoke harness controls the
  Electron launch;
- first editor interaction timing inside the renderer smoke hook;
- first JavaScript, TypeScript, and Python run timings;
- total smoke wall-clock duration;
- memory snapshots before the smoke cases and after each case.

Memory data is diagnostic. Platforms that cannot expose the metric
return `unsupported` instead of failing the smoke.

When that desktop smoke artifact exists, `performance:report` includes a
`runtimeObservability` section in both
`output/performance/performance-report.json` and
`output/performance/performance-report.md`. When it does not exist,
the report marks runtime observability as unavailable instead of
failing; this keeps CI web builds readable while still surfacing the
startup/runtime follow-up work in local release validation.

## Lazy Monaco language registration

Monaco language contributions register per active language through
`registerLanguageOnce(monaco, languageId)` (see `src/renderer/monaco.ts`),
not all at once on first editor mount. JavaScript and TypeScript are
pre-registered for the scratchpad happy path; every other language —
its tokenizer chunk and its completion / hover / signature provider
modules — loads the first time a tab activates it.

The practical effect on this report: the per-language editor-provider
modules (`goCompletions`, `rustCompletions`, `pythonCompletions`,
`rubyCompletions`, `luaCompletions`, and their hover/signature siblings)
ship as `lazy` chunks instead of being statically pulled into the
`initial` bundle. Opening a JavaScript scratchpad no longer fetches the
Go/Rust/Python/Ruby/Lua provider chunks; `tests/e2e/monacoLazyLanguages.spec.ts`
guards that contract. The web `initial` bundle dropped accordingly
(measured ~13 KiB raw / ~2.6 KiB gzip on the `index` chunk at landing).
Refresh `docs/performance/baseline.json` to tighten the ceiling after a
full `build:web` + desktop-renderer build per "Refreshing the baseline".

## Lazy Developer Utilities panels

The Developer Utilities workspace shell is itself a lazy chunk, and `UtilityPanelRegistry`
now loads each tool's panel through `React.lazy` (see
`src/renderer/components/DeveloperUtilities/UtilityPanelRegistry.ts`), with
`<Suspense>` in `UtilityPanels.tsx` and an on-hover `prefetchUtilityPanel` warm
from the sidebar. Single-use deps (`qrcode`, `sql-formatter`) load via dynamic
import at their util call sites.

Effect on this report: the shared `DeveloperUtilities` chunk drops from ~362 KiB
to ~19 KiB, and each panel (plus its deps) becomes its own `lazy` chunk — so
opening Utilities on JSON or Base64 no longer pays for the QR / SQL / Markdown
panels. The `initial` bucket stays flat (the workspace shell was already lazy,
so there was nothing in `initial` to remove); the win is the per-tool split in
the `lazy` bucket, which grows in file count as the single 362 KiB chunk fans
out.
`tests/e2e/devUtilitiesLazyPanels.spec.ts` guards that the default tool does not
fetch the heavy panel chunks and that selecting QR loads its chunk on demand.

## Budget policy

The baseline stores current measurements plus conservative headroom:

- `initial`: baseline + 10%
- `lazy`: baseline + 15%
- `utility`: baseline + 15%
- `worker`: baseline + 10%
- `runtime`: strict; change only when the runtime asset version changes
- `other`: baseline + 10%

Normal CI runs `pnpm run performance:report` after `pnpm run build:web` so
reviewers can see the table in logs, then runs `pnpm run check:performance`
as the explicit blocking budget gate for build outputs that exist on disk.
A strict release/local check can require every baseline target with:

```bash
node ./scripts/performance-report.mjs --check --require-all-targets
```

## Refreshing the baseline

Refresh the baseline only when a reviewed feature intentionally changes
bundle/runtime size.

```bash
pnpm run build:web
pnpm run smoke:desktop
pnpm run performance:baseline
pnpm run check:performance
```

`performance:baseline` requires every versioned target to exist so a
web-only refresh cannot accidentally delete desktop renderer budgets.
Use `performance:report` for a non-mutating web-only report; it still
marks the desktop renderer as unavailable when that build output is not
present. Run `pnpm run smoke:desktop` before `performance:report` when
you want the runtime observability section populated from a fresh smoke
artifact.

## Investigating regressions

1. Run `pnpm run performance:report`.
2. Open `output/performance/performance-report.md`.
3. Check the largest-assets list for the category that regressed.
4. Check the Runtime Observability section for launch-to-smoke-ready,
   first editor interaction, first-run language timing, and memory delta
   drift.
5. Confirm whether the file moved into `initial`; Pyodide and
   Developer Utilities chunks should not become initial assets.
6. If the increase is intentional, document the reason in the change record
   closeout before refreshing `docs/performance/baseline.json`.

## Manual test

1. Run `pnpm run build:web`.
2. Run `pnpm run performance:report`.
3. Confirm the terminal shows a table with initial bundles, lazy
   chunks, workers, runtime assets, and utilities.
4. Open `output/performance/performance-report.json` and confirm it
   contains `generatedAt`, `budgets`, `measurements`, `violations`, and
   `runtimeObservability`.
5. Run `pnpm run check:performance` and confirm it passes against the
   committed baseline.
6. Run `pnpm run smoke:desktop`.
7. Open `output/playwright/desktop-smoke/desktop-smoke-performance.json`
   and confirm it includes launch-to-smoke-ready, first editor
   interaction, JS, TS, Python timings, and memory snapshots or an
   `unsupported` memory result.
8. Run `pnpm run performance:report` again and confirm
   `output/performance/performance-report.md` includes the Runtime
   Observability section populated from the desktop smoke artifact.
9. Confirm Pyodide and Developer Utilities assets are not listed as
   `initial` in the performance report.
10. Confirm the report is readable from terminal or CI logs without
    opening Lingua.
