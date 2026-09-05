# Performance budgets

Lingua tracks performance as an engineering/release surface, not as a
user-facing app panel. The current gate is intentionally dev/CI only:

- `pnpm run performance:report` prints a table and writes
  `output/performance/performance-report.{json,md}`.
- `pnpm run performance:activation` runs repeated cold web and desktop
  activation samples and writes
  `output/performance/activation-performance.{json,md}`.
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

`performance:activation` adds the missing repeated web measurement and
aggregates repeated desktop smoke artifacts. The default is three samples
per case; override it with `--samples=N` or narrow a local pass with
`--surface=web` / `--surface=desktop`. Use `--skip-build` only when
`dist/web` is already a production-shaped build.

The activation definitions are deliberately observable:

- **Web cold landing ready** — earliest `lingua:boot:start` mark to the
  rendered license badge in a fresh Chromium process/context using the
  first-install `welcome.js` scratchpad.
- **Web first editor interactive** — the same boot mark to visible Monaco
  view lines; the harness then edits the buffer before accepting the sample.
- **Web first Run** — the exact Run-button click to the
  `data-running=true -> false` lifecycle plus a successful active-tab state.
- **Desktop first editor interactive** — adding the first smoke tab to a
  mounted active Monaco instance with a model. This replaced the old fixed
  220 ms sleep, which was not a real readiness measurement.
- **Desktop first Run** — the existing JS, TS, and Python smoke executions,
  preserving both wall time and runner-reported execution time.

Every wall-clock metric reports median, p25, p75, IQR, min, max, and sample
count. These values are diagnostic only: machine load and OS caches make them
unsuitable as blocking CI thresholds. Bundle raw/gzip ceilings remain the
blocking performance gate.

When that desktop smoke artifact exists, `performance:report` includes a
`runtimeObservability` section in both
`output/performance/performance-report.json` and
`output/performance/performance-report.md`. When it does not exist,
the report marks runtime observability as unavailable instead of
failing; this keeps CI web builds readable while still surfacing the
startup/runtime follow-up work in local release validation.

## Initial graph and lazy overlay boundaries

`App` mounts `AppOverlays` on every boot. A conditional render inside that
component is therefore not a bundle boundary: any static import in
`src/renderer/components/AppOverlays.tsx` belongs to the initial graph even
when the matching overlay is never opened.

Keep user-triggered overlays behind `React.lazy`. Data imported only by one
overlay must cross the same boundary; for example, `WhatsNewOverlay` owns the
release-copy import so `src/renderer/data/changelog.ts` is not downloaded until
What's New opens. Do not move that import back into `AppOverlays`.

`tests/build/monacoInitialGraph.test.ts` walks static imports from both shipped
entries and fails with the import chain when Monaco, selected overlay-only
modules, tokenizers, or language workers become boot-reachable. The walker and
Vite consume the same ordered alias maps from `build/viteAliases.mts`; add or
change renderer-facing aliases there rather than duplicating them per config.
The bundle budget remains the second line of defense because it catches costs
that a source-graph allowlist cannot predict.

`scripts/lib/staticImportGraph.mjs` is the shared implementation behind that
guard and the activation report. The report records every eager App-to-package
chain for `acorn`, `js-yaml`, and `magic-string`; this keeps performance
decisions tied to the current source graph rather than a hand-maintained
diagram.

Recipe language capability checks follow the same narrow-boundary rule.
`src/shared/recipeLanguages.ts` owns the tiny synchronous tuple and predicate
needed by Save-As, while `src/shared/lessonRunner.ts` keeps assertion source
composition and result parsing behind the lazy Recipes overlay and run panel.
The initial-graph guard names the full runner explicitly so persistence cannot
pull it back into every workspace through a convenience import.

The floating Variables inspector is activation-scoped as well.
`FloatingVariablesCardHost.tsx` keeps only primitive tab eligibility, the
surface, and the matching-scope gate in the workspace graph, so editor
keystrokes do not re-render the dormant boundary. Its loader requests the
draggable portal and value renderer only after Variables is enabled for a
supported non-Node tab. Loading and failed-chunk states remain visible and
localized; a failed module URL offers a page reload because retrying it in the
same document is not reliable.

Recent Runs uses a narrower activation boundary because its trigger must remain
discoverable. `RecentRunsPill.tsx` keeps the per-tab count, Free upsell, and
global keyboard opener in the initial graph, selecting only primitive active-tab
fields so buffer edits do not re-render the trigger. Opening an eligible Pro
history mounts `RecentRunsPopoverHost.tsx`, whose cached loader requests the row
renderer, relative-time interval, pin/replay controls, runner integration, and
icons. A successful chunk is reused for later opens; a failed module URL stays
cached for the document and surfaces a localized reload action. The build graph
guard keeps `RecentRunsPopover.tsx` deferred, while the E2E contract verifies
that no matching resource is present before activation and only one is fetched
across repeated opens.

Editor-tab actions follow the same trigger-first rule.
`EditorTabs.tsx` keeps tab rendering, activation, close, rename, overflow, and
right-click/Shift+F10 detection in the initial graph.
`EditorTabContextMenuHost.tsx` then requests the cached portal implementation
only after an actual context-menu activation. A failed request closes safely
and reports localized reload guidance through the shared status-notice surface;
the loaded menu owns focus management, dismissal, and keyboard navigation. Its
anchor is clamped to the viewport so an edge activation cannot clip the menu.
The source-graph and E2E guards keep the implementation absent before
activation and reused after its first successful load.

Run Capsule export follows an availability-first boundary.
`RunCapsuleExportButtonHost.tsx` keeps only the execution-history eligibility
check in the initial graph and requests the icon control after the first
capsule exists. `useAppShortcuts.ts` keeps Mod+Shift+X registered and its
no-capsule guidance immediate, but loads the shared sanitizer, serializer,
clipboard writer, telemetry, and trust capture only after a usable capsule is
confirmed. Both paths share document-cached loaders and localized recovery
copy for failed chunks. The source-graph guard keeps both
`RunCapsuleExportButton.tsx` and `utils/exportCapsule.ts` deferred. In the
production web profile this boundary reduced the initial graph from 18 to 17
chunks, from 1,010,078 to 1,002,999 raw profile bytes, and from 291,407 to
289,169 gzip-9 bytes.

Active notebook export follows the same eligibility-first rule. The Command
Palette keeps its always-available action and checks the already-eager active
tab synchronously: a non-notebook receives immediate localized guidance
without downloading the export implementation. Only an eligible notebook
requests the cached exporter, which reads notebook state and owns `.linguanb`
serialization, disk/download choreography, and telemetry. A rejected chunk is
evicted so a later explicit action can retry, while the current action reports
localized failure guidance. The source-graph guard keeps the export
orchestrator, serializer, and disk helper out of both shipped startup graphs.
The notebook store itself remains eager because editor tab lifecycle actions
also own its cleanup independently of export. In the production web profile,
this boundary reduced the statically reachable source graph from 288 to 281
modules and the initial payload from 1,161,021 to 1,158,360 raw bytes and from
304,226 to 303,387 gzip-9 bytes, while retaining 14 initial files.

The HTTP privacy policy is a separate startup-safe leaf. Settings needs the
immutable sensitive-header baseline during hydration, but it does not need the
complete HTTP request schema, parsers, auth composition, capture/assertion
rules, or serializers. `shared/httpSensitiveHeaders.ts` owns the canonical
baseline and exact-match predicate; `shared/httpWorkspace.ts` preserves its
historical re-export for activated callers. The source-graph guard prevents the
full workspace module from returning to either startup graph. The alias-aware
source graphs retained 282 web modules and 279 renderer modules because the
leaf replaces the monolith, but removed 44,234 bytes of reachable source and
lowered the largest eager source file from 45,307 to 27,688 bytes. In the
production web profile, the initial payload retained 14 files while falling
from 1,158,360 to 1,148,888 raw bytes and from 303,387 to 300,712 gzip-9 bytes.
The desktop renderer retained 16 initial files while falling from 1,147,860 to
1,138,391 raw bytes and from 300,339 to 297,688 gzip-9 bytes.

Import Preview has a second HTTP boundary inside its already-lazy surface.
`shared/httpWorkspaceSchema.ts` contains the dependency-free request/response
contract and blank factory needed to parse and display cURL, Postman, and Bruno
input. The store-writing `hooks/importPreviewConfirm.ts` is requested only
after the user confirms a valid preview; that module activates the HTTP
collection, parser/behavior facade, editor stores, and workspace-tab bridge.
Failed confirmation loads are evicted for retry, while the button exposes its
busy state and localized recovery guidance prevents silent failure. A focused
source-graph guard keeps both the confirmation module and
`shared/httpWorkspace.ts` out of the preview graph. The graph fell from 105 to
65 modules and from 870,059 to 538,545 reachable source bytes (40 modules and
331,514 bytes deferred). Production startup stayed effectively flat: web kept
14 initial files at +206 raw / +91 gzip-9 bytes, while the desktop renderer
added one 483-byte shared-schema chunk and changed by +538 raw / +528 gzip-9
bytes. The activated build now exposes the deferred confirmation and workspace
implementation as independent lazy chunks (2,884 and 9,146 raw bytes in the
web build), so opening the preview no longer implies loading them.

The confirmation path also keeps persistence validation separate from active
HTTP behavior. `shared/httpWorkspacePersistence.ts` owns the strict request and
response parsers, while `shared/httpWorkspace.ts` re-exports them only for
compatibility. The store imports the persistence leaf directly, and a focused
graph guard prevents the behavior facade from returning through rehydration.
The confirmation source graph retained 100 modules while falling from 809,541
to 790,179 reachable bytes (19,362 bytes deferred). Production startup stayed
flat: web retained 14 initial files at +58 raw / +1 gzip-9 byte, and the
desktop renderer retained 17 initial files at +53 raw / +1 gzip-9 byte. The
former 9,146-byte web behavior chunk is now a 4,271-byte behavior chunk plus a
4,878-byte persistence chunk; persistence-only activation therefore avoids
4,268 raw / 1,473 gzip-9 bytes of behavior. The extra split costs 83 raw / 220
gzip-9 bytes in the complete web lazy corpus and 83 raw / 280 gzip-9 bytes in
the desktop renderer, an explicit tradeoff for a smaller trust-boundary
dependency and independently loadable behavior.

Keyboard shortcuts separate startup behavior from reference presentation.
`data/keyboardShortcuts.ts` keeps ids, groups, default combos, matching,
override resolution, and platform-aware formatting in the initial graph so
dispatch and compact hints remain immediate. Localized labels, descriptions,
group copy, and search keywords live in
`data/keyboardShortcutReference.ts`, which is shared by the already-lazy
Settings and shortcut-editor chunks. The source-graph guard prevents this
reference metadata from becoming statically reachable from either entry, while
the E2E contract verifies that the shared chunk is absent before Settings,
fetched once, and reused by the full editor. In the production web profile this
reduced the initial catalog's rendered contribution from 17,632 to 8,906 bytes
and the complete initial graph from 1,002,999 to 996,059 raw profile bytes and
from 289,184 to 287,609 gzip-9 bytes, while retaining 17 initial chunks.

## Activation baseline and startup-loading decision

Reference sample captured on 2026-07-28 (Apple M4 Max, 14 logical CPUs,
36 GiB RAM, Node 24.18.0; three samples per case):

| Surface | Metric                   |   Median |   IQR |        Range |
| ------- | ------------------------ | -------: | ----: | -----------: |
| Web     | Cold landing ready       |    86 ms |  1 ms |     85-87 ms |
| Web     | First editor interactive |   475 ms |  5 ms |   471-487 ms |
| Web     | First JavaScript Run     |    39 ms |  2 ms |     36-40 ms |
| Web     | First TypeScript Run     |   163 ms |  3 ms |   159-164 ms |
| Desktop | Launcher to smoke ready  | 1,006 ms |  7 ms | 995-1,008 ms |
| Desktop | First editor interactive |   359 ms |  4 ms |   357-365 ms |
| Desktop | First JavaScript Run     |   640 ms | 26 ms |   602-654 ms |
| Desktop | First TypeScript Run     |   159 ms |  7 ms |   157-170 ms |
| Desktop | First Python Run         |   752 ms |  7 ms |   747-761 ms |

That earlier decision has since been superseded by narrower, measured
boundaries. `useRunner` and the auto-run debounce keep their small controls
ready, while manual execution, accepted auto-run execution, debugger
instrumentation, dependency parsers, and YAML validation load only when their
workflow starts. The activation report now proves that `acorn`, `js-yaml`, and
`magic-string` have no static path from `App`; do not reintroduce them through a
convenience barrel.

A 2026-08-01 verification after the final startup boundary (three JavaScript
and three TypeScript samples on the same host) recorded 120 ms median cold
landing, 594 ms first editor interaction, 84 ms first JavaScript Run, and 458
ms first TypeScript Run. These wall-clock values remain diagnostic rather than
budgets; the stable outcome is the empty eager-package evidence and the
blocking raw/gzip ceiling.

## Progressive onboarding and dependency detection

Completed onboarding and background package classification are not first-paint
requirements:

- `useOnboardingChoreography` keeps a small persisted-stage predicate in the
  startup graph. It imports `onboardingChoreographyRuntime` only when a welcome,
  first-run, or first-snippet stage is incomplete. The runtime replays the
  latest run, console, and snippet state before subscribing, so async loading
  cannot lose a fast user action.
- `DependencyDetectionHost` waits for the first browser idle opportunity (with
  a one-second bound) before mounting the keystroke observer. Sessions that
  start with detection disabled do not fetch it; activated sessions keep it
  mounted so opting out still aborts work and clears in-memory package names.
- `dependencyDetectionPaste` is a tiny leaf shared with lazy Monaco, preserving
  the 60 ms post-paste debounce without coupling the editor to the classifier.

The source-graph guard now locks both implementation modules behind dynamic
imports. In the production web profile, this reduced the static startup graph
from 287 to 284 modules and the initial payload from 1,190,952 to 1,186,287 raw
bytes and from 312,765 to 311,453 gzip-9 bytes, while retaining 22 initial
files. Completed onboarding requests no runtime chunk; enabled dependency
detection begins after first paint rather than competing with it.

Desktop's larger runtime asset bucket is also intentional, not removable
duplication. `CAPABILITY_MATRIX.md` and `RUNTIME_ASSETS_ADR.md` keep Pyodide as
Python's primary runtime in both shells so packaged desktop remains offline and
does not require system Python. A native CPython path remains a separate
promotion/research decision driven by arbitrary `pip` demand.

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

The check also reports two conditions that are not byte overages:

- **Build shape.** A `dist/web` that contains `duckdb-mvp-*.wasm` or
  `ruby+stdlib.wasm` was built with `LINGUA_WEB_RUNTIME_SAME_ORIGIN=1` (the
  hermetic e2e shape); production points those runtimes at R2. The check
  fails with a single `shape` violation naming the files instead of a wall
  of runtime overages — run `pnpm run build:web` and check again. The
  desktop renderer is exempt because it ships every runtime same-origin.
- **Budget slack.** When `initial` or `lazy` measures below 75% of its
  committed baseline, the budget has stopped protecting that category: the
  ceiling still sits at the old size plus headroom. The report prints a
  `Budget warnings` block pointing at the refresh command; pass
  `--fail-on-slack` to make it a gate.

The baseline was re-synchronized after v0.15.0 because an exact
`origin/main` build already exceeded the older pre-release initial ceiling;
the current branch changed the initial bundle by less than 1 KiB relative to
that release build. This refresh establishes the shipped release shape as the
new baseline instead of masking future growth behind a permanently failing
gate.

## Refreshing the baseline

Refresh the baseline only when a reviewed feature intentionally changes
bundle/runtime size.

```bash
pnpm run build:web
pnpm run smoke:desktop
pnpm run performance:baseline
pnpm run check:performance
```

`performance:baseline` refreshes only the targets that have a build
output on disk and keeps the committed budgets of the rest, so a
web-only refresh on a laptop without a desktop renderer build is safe:

```bash
pnpm run build:web
pnpm run performance:baseline --target=web
pnpm run check:performance
```

The baseline records `lastRefresh` per target so a review can see which
half was measured when. Add `--require-all-targets` when a refresh must
cover every target (release cuts); do not combine it with `--target`.
An explicit `--target` also fails when that target's build output is
missing instead of succeeding without refreshing it. Use
`performance:report` for a non-mutating report; it still marks the desktop
renderer as unavailable when that build output is not present. Run
`pnpm run smoke:desktop` before `performance:report` when you want the runtime
observability section populated from a fresh smoke artifact.

A baseline cannot be written from a build created with
`LINGUA_WEB_RUNTIME_SAME_ORIGIN=1` — `performance:baseline` refuses the
shape. That flag intentionally copies oversized Ruby and DuckDB assets for
hermetic local e2e coverage; production builds use the owned R2 runtime
URLs and are the only valid input for release budgets. After a local
`pnpm run test:e2e:web`, `dist/web` holds that shape until the next
`pnpm run build:web`.

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
11. Run `pnpm run performance:activation -- --samples=3` and confirm the
    generated activation report contains web and desktop samples, median/IQR
    summaries, memory availability, and eager runner dependency chains.
12. Confirm every web sample records `consoleErrors: []`.
