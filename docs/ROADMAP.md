# Lingua — Roadmap

> **Updated:** 2026-05-05
> Canonical status board. Single source of truth for the `Status` column
> on every `RL-XXX` ticket. When any other doc disagrees, this one wins.
>
> **For quick lookup:** read this file. It's cheap — one compact table,
> no deep-dives.
>
> **For full scope + acceptance criteria:** each ticket links back to
> `docs/PLAN.md#RL-XXX`. Load PLAN.md only when a ticket genuinely needs
> its deep context.
>
> **For currently-active per-commit execution detail:** see
> [`docs/SPRINT-PLAN.md`](./SPRINT-PLAN.md).
>
> **For pre-commitment raw ideas:** see [`docs/BACKLOG.md`](./BACKLOG.md).

---

## 1. Status legend

A closed enum. Every `RL-XXX` ticket sits in exactly one bucket.

| Value | Meaning | Eligible for next step? |
|-------|---------|-------------------------|
| `Done` | Fully shipped and validated. | No |
| `Partial` | Started — one or more slices landed. `Readiness` names which, and what's left. | **Yes** — pick the smallest unshipped slice |
| `Planned` | Spec'd but no code. | **Yes** — only after Partial pool is exhausted |
| `Research-backed spike` | ADR filed, no production code. Parked on purpose. | No (unless explicitly promoted) |
| `Deferred study` | Parked for a later revisit window. | No |
| `Superseded` | Original scoping replaced by newer `RL-XXX`. `Readiness` names the successor. | No — pick the successor instead |
| `Gated` | External dependency (contract, hardware, credentials) blocks start. `Readiness` names the gate. | No — waiting on external |

New tickets start as `Planned`. Tickets close to `Done` only when every
acceptance item is green in the test suite and the slice is behind at
least one Playwright or desktop smoke assertion.

## 2. Priority tiers

| Priority | Meaning |
|----------|---------|
| `P0` | Unblocks other work or launch — pick first. |
| `P1` | Scheduled next. Most of the active backlog lives here. |
| `P2` | Scheduled but not urgent. |
| `P3` | Nice-to-have. Don't pick unless P0-P2 are empty in the adjacent theme. |
| `Future` | Explicit parking lot. Do not pick without a promotion decision. |

## 3. Picking the next ticket

1. **Pool** = all rows in §4 whose `Status ∈ {Partial, Planned}`.
2. Exclude anything marked `Gated`, `Deferred study`, `Research-backed spike`, or `Superseded`.
3. For `Partial` rows, the implementable scope is whatever `Readiness`
   names as unshipped. Prefer these over `Planned` — scaffolding exists.
4. Respect `Dependencies` — if any dep is not `Done`, the ticket is not
   implementable yet.
5. Follow the sequencing recommendation in §5 when two tickets are both
   eligible.

**Never invent new RL ids.** If a slice needs finer granularity, add a
sub-section inside the existing ticket's `docs/PLAN.md` entry. New
inbound work goes to `docs/BACKLOG.md` first and graduates to ROADMAP
only once it has acceptance criteria.

## 4. Active backlog

All tickets with `Status ∈ {Partial, Planned, Research-backed spike}`. The
`Scope` cell is a one-line summary; follow the link for deep detail.

### 4a. Launch-blocking (P0)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|
| [`RL-059`](./PLAN.md#rl-059-license-key-infrastructure) | License-key infrastructure | `Partial` | Ed25519 verifier + Settings section + main-side IPC bridge with device id (Slice 0 shipped 2026-04-25). Remaining: Polar webhook + email delivery (now lives under `RL-061`). |

### 4b. Editor, runtime and workflow (P1)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|
| [`RL-019`](./PLAN.md#rl-019-add-explicit-jsts-runtime-modes-worker-scratchpad-desktop-node-and-browser-preview) | Explicit JS/TS runtime modes | `Planned` | Per-tab runtime selector: worker scratchpad / desktop Node / browser preview. |
| [`RL-020`](./PLAN.md#rl-020-make-the-scratchpad-and-repl-experience-best-in-class) | Scratchpad / REPL excellence | `Planned` | Smart auto-run + multi-line editor history + quick inspect. |
| [`RL-023`](./PLAN.md#rl-023-build-snippet-lab-and-algorithm-practice-mode) | Snippet Lab + algorithm practice | `Planned` | Tagged snippet collections + "compare two snippets" + saved assertions. |
| [`RL-024`](./PLAN.md#rl-024-support-multi-file-playgrounds-assets-and-starter-galleries) | Multi-file playgrounds + starter galleries | `Planned` | Multi-file workspaces, static assets, per-language starter templates. |
| [`RL-025`](./PLAN.md#rl-025-add-package-and-dependency-management-in-a-language-aware-way) | Package / dependency management | `Planned` | Language-aware package install UI for JS/TS (desktop) and Python (Pyodide). |
| [`RL-031`](./PLAN.md#rl-031-add-a-local-ai-code-assistant-focused-on-algorithms-and-cross-language-generation) | Local AI code assistant | `Planned` | Desktop-only local-model assistant focused on algorithms + cross-language generation. |
| [`RL-032`](./PLAN.md#rl-032-build-a-dedicated-marketing-website-and-docsdownload-hub) | Marketing website + docs hub | `Planned` | Separate marketing site at linguacode.dev with docs/download/pricing. |
| [`RL-033`](./PLAN.md#rl-033-upgrade-to-the-latest-vite-major-and-harden-the-bundling-surface) | Vite major upgrade | `Partial` | ADR landed; upgrade itself blocked on four upstream peer-range checks from the ADR. |
| [`RL-036`](./PLAN.md#rl-036-add-sharing-collaboration-and-publish-flows) | Sharing, collaboration, publish flows | `Planned` | Phase A: share-by-link, publish-as-static, snippet export. |

### 4c. Language platform (P2)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|
| [`RL-027`](./PLAN.md#rl-027-add-debugger-mvp) | Debugger MVP | `Partial` | ADR landed 2026-04-20. Slice 1 partial-staged 2026-05-09. **Slice 1.5 shipped 2026-05-11** — BreakpointGutter Monaco glyph-margin (red dots + click → toggle, `Mod+Shift+B` keyboard path), mounted debugger surface with chevron collapse + persisted state, visible Settings → Editor → Debugger master toggle, three telemetry events (`debugger.attached` / `debugger.paused` / `debugger.detached` with closed-enum payloads), JS+TS `capabilities.debugger` flipped to `'available'`, esbuild TS→JS source-map composition via `@jridgewell/trace-mapping` so TS breakpoints pause at user line, `docs/DEBUGGER_SLICE1.md` runbook, ADR amendment, CAPABILITY_MATRIX rows for JS/TS/Python/Go/Rust debuggers, and blocking e2e smoke in `tests/e2e/debuggerJs.spec.ts`. **2026-05-12 UX refinement**: JS/TS Run and Debug now live in one split dropdown; Run ignores breakpoints, Debug requires an enabled breakpoint, highlights the paused line, streams prior console output while paused, suspends the parent timeout until Continue / Step resumes execution, moves Debugger into the resizable bottom panel as a Console sibling tab, moves breakpoint count / Disable all / Clear actions into that Debugger panel instead of the toolbar or Settings, and supports Step Into / Step Out for local synchronous functions during Debug. **Remaining for Slice 1.5b**: conditional-breakpoint predicate evaluation + watch-expression evaluation (deferred behind a dedicated security review of the worker eval pattern — the dynamic-Function constructor pattern hit the security_reminder hook during Slice 1, and the inline-fix policy carve-out keeps it out of 1.5). |
| [`RL-042`](./PLAN.md#rl-042-expand-language-support-toward-15-languages) | Expand languages toward 15+ | `Partial` | Ruby, Java, Kotlin, Scala, Swift, C, C++ open in view/lint mode. Runnable tiers pending per-lang. |

### 4d. Execution deepening and tooling (P2)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|
| [`RL-011`](./PLAN.md#rl-011-add-an-environment-variables-panel-for-execution-contexts) | Env vars panel | `Partial` | Slice A/B/C shipped + Slice D for Go/Rust/Python. Remaining: JS/TS desktop runner env threading. |
| [`RL-012`](./PLAN.md#rl-012-package-management) | Package management | `Planned` | Superseded in scope by `RL-025`. Keep open for reference until `RL-025` ships Slice A. |
| [`RL-043`](./PLAN.md#rl-043-add-notebook--cell-based-execution-mode) | Notebook / cell-based execution | `Planned` | New notebook view alongside the editor with per-cell output. |
| [`RL-044`](./PLAN.md#rl-044-add-inline-data-visualization-and-rich-output-rendering) | Inline data visualization + rich output | `Planned` | Detect structured output (tables, images, plots) and render richly. |
| [`RL-048`](./PLAN.md#rl-048-add-integrated-terminal-for-desktop-mode) | Integrated terminal (desktop) | `Planned` | Embed xterm.js + node-pty panel in the desktop build. |

### 4e. Developer Utilities (`RL-045` parent is `Done`)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|
| [`RL-069`](./PLAN.md#rl-069-devutils-class-productivity-layer-for-the-utilities-workspace) | DevUtils-class productivity layer | `Done` | Slice 1 shipped 2026-05-05 (Cmd/Ctrl+K + Cmd+Shift+C/Cmd+Alt+R + fuzzy search + 5 output providers). Slice 2 shipped 2026-05-09 (`detect()` on 27 panels + `<UtilityToolbar>` + Mod+Shift+A + 29-panel coverage). Slice 3 shipped 2026-05-09 — `utilityHistoryStore` with isolated `lingua-utility-state` localStorage key + 10-entry FIFO cap + 16KB-per-entry truncation + 256KB total budget; `<UtilityHistoryDrawer>` rendered inside the toolbar so every non-generator panel inherits Recent runs + per-tool persist toggle + Clear; `<FavoritesRow>` + `<FavoriteToggleButton>` with `@dnd-kit/sortable` (mouse + keyboard a11y); `useClipboardOnFocus` hook with `utilitiesClipboardOnFocusConsent` three-state (RL-065 pattern); new `UtilitiesSection` Settings entry under the Editor tab (toggle + Clear-all-history with confirmation); 3 new RL-065 telemetry events (`utility.favorite.pinned`, `utility.history.cleared`, `utility.clipboard.applied`); 10 Playwright assertions in `tests/e2e/utilitiesPersonalize.spec.ts` cover pin/reorder/reload, history Apply + persist + Clear, Settings clipboard toggle, JWT + CRON + 6 more panels in the Apply rotation, Spanish locale, and console-clean. |
| [`RL-072`](./PLAN.md#rl-072-specialty-utilities--qr--string-inspector) | Specialty utilities — QR + inspector | `Done` | String Inspector + QR generate shipped earlier. Final slice on 2026-05-08 added QR decode (drag-drop image), Copy-as-PNG, FG/BG color pickers with WCAG-AA contrast guard, high-contrast preset, SVG download alongside PNG, and `utilityOutputStore` wiring (Cmd+Shift+C / Cmd+Alt+R). Camera capture remains explicitly deferred per the original scope decision. |

### 4f. Launch operations (P1)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|

_All rows in this section are closed; see §6 archive. RL-065 closed 2026-05-12 with Slice 5 — telemetry export endpoint on `update-server` (POST /telemetry, allowlist+deny-pass+rate-limit, Workers Observability persistence, web-only env wiring, update.checked callsite, URL validation, Playwright consent-gate assertion, telemetry-pipeline.md runbook with the D1 promotion path)._

### 4g. Personalization and surface polish (P2)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|
| [`RL-039`](./PLAN.md#rl-039-add-guided-lessons-docs-and-app-galleries-for-students) | Guided lessons + app galleries | `Partial` | Built-in guided tour + seeded lesson drafts in `docs/lessons`. Remaining: in-app lesson browser + progression. |
| [`RL-041`](./PLAN.md#rl-041-add-static-site-export-and-one-click-publish-for-web-projects) | Static site export + publish | `Planned` | Export JS/TS/HTML projects as self-contained static ZIP; one-click publish to GitHub Pages. |
| [`RL-046`](./PLAN.md#rl-046-add-gamification-achievements-and-progress-tracking-for-students) | Gamification + achievements | `Planned` | Achievement catalog, per-user progress, streaks. |

### 4h. Documentation and repo hygiene (P2)

_All rows in this section are closed; see §6 archive. RL-082 closed 2026-05-05 (README slimmed to ~130 lines, `DEVELOPMENT.md` + `USAGE.md` introduced)._

### 4i. Security, resilience, and product quality (P2)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|

### 4j. Research-backed spikes and future

These rows are NOT candidates for the next step. They live here for
discoverability only.

| ID | Title | Status | Note |
|----|-------|:------:|------|
| [`RL-029`](./PLAN.md#rl-029-pilot-webcontainers-for-jsts-web-projects-only) | WebContainers pilot | `Research-backed spike` | ADR filed; no production code. Promotion gated on a distinct product decision. |
| [`RL-035`](./PLAN.md#rl-035-run-a-tauri-2-feasibility-spike-without-committing-to-migration) | Tauri 2 feasibility spike | `Partial` | Spike ADR (`TAURI_SPIKE_ADR.md`) shipped. No decision to migrate. |
| [`RL-047`](./PLAN.md#rl-047-add-algorithm-visualization-and-step-through-animation) | Algorithm visualization | `Planned` | Priority `Future` — will not start until Debugger MVP (`RL-027`) is `Done`. |
| [`RL-049`](./PLAN.md#rl-049-add-macro-recording-and-playback) | Macro recording | `Planned` | Priority `Future` — not in the next two quarters. |
| [`RL-050`](./PLAN.md#rl-050-add-real-time-collaboration-for-shared-sessions) | Real-time collaboration | `Planned` | Priority `Future` — Phase A would be LAN-only WebRTC; not committed. |

## 5. Recommended sequence

Value-per-day priority, skipping parked tickets. This is the order an
agent should follow when §3's tiebreakers don't resolve.

1. **Security launch hardening.** `RL-077`, `RL-078`, `RL-079`, and `RL-083` are all closed. 2026-05-08 follow-up hardening moved web Pyodide from cache-first CDN loading to same-origin copied runtime assets, tightened filesystem re-open approvals, and extended Go/formatter/parser caps. The launch-blocker set is clear.
2. **Launch blockers.** Closed. `RL-063` shipped 2026-05-05 — site live at https://linguacode.dev from the separate `lingua-marketing` repo (see `MARKETING_SITE_ADR.md`). `RL-061` shipped 2026-04-30. `RL-059` stays `Partial` only as the historical parent for verifier + bridge work now shipped.
3. **Release, legal, and compliance readiness.** Closed. `RL-080`, `RL-085`, `RL-092`, and `RL-081` are all `Done` (RL-081 closed 2026-05-05 once the live `linguacode.dev` surface aligned with the desktop entitlement copy). The launch-readiness bucket has no outstanding blockers in this repo.
4. **Runtime/platform surface hardening.** `RL-091` closed 2026-05-06 (structured logging + redaction + metrics catalog + readiness probes across both Cloudflare Workers + 5 incident runbooks + observability spec). `RL-084` closed 2026-05-06 (shared validator + path-traversal guard + bundled-runtime allowlist + new `unknown` status + UI test coverage). `RL-087` closed 2026-05-06 (watcher lifecycle audit + typed failure diagnostics surfaced via status notice + `IGNORED_PATH_PREFIXES` shared module + `before-quit` cleanup + USAGE.md platform-limitations section). The §5 #4 hardening lane is now closed in full.
5. **Product quality and supportability.** Closed in full. `RL-088` closed 2026-05-06 (axe-core gate via `tests/e2e/a11y.spec.ts`, keyboard-only flows, OverlayBackdrop focus restoration, plus the `docs/A11Y.md` manual checklist). `RL-086` closed 2026-05-07 (bundle/runtime performance budgets, baseline report, CI logs, desktop smoke runtime/memory metrics, and `runtimeObservability` folded into the central performance report). `RL-089` closed 2026-05-07 (versioned profile export/import with three conflict policies, replace-confirm modal, file picker + paste fallback, and explicit machine-bound exclusion list). `RL-090` closed 2026-05-07 (top-level error boundaries with redacted error report + clipboard fallback, global error listeners, safe-mode boot via `?safe-mode=1`, boot-loop counter escalating to factory mode after 3 crashes in 60s, RecoverySection with five scoped resets + reveal-folder, and `docs/RECOVERY.md` support documentation).
6. **Utilities polish.** Closed in full. `RL-072` closed 2026-05-08 (QR decode + Copy-as-PNG + colors + SVG + utilityOutputStore wiring). `RL-069` closed 2026-05-09 — Slice 1 (productivity foundation), Slice 2 (detect + Apply + 29-panel coverage), and Slice 3 (clipboard-on-focus + history + favorites with `@dnd-kit` drag-reorder + new `UtilitiesSection` Settings + RL-065 telemetry events) all shipped same day window. The lane is empty.
7. **Debugger + language intelligence.** `RL-026` closed 2026-05-11 — Slice 4 (Go via gopls — diagnostics + completions + hover + signature help) shipped alongside Slice 3 (Rust via rust-analyzer) earlier the same day; both run on the shared LSP scaffold (`src/main/lsp/lspProcess.ts`, `src/main/ipc/lsp.ts` allowlist) and the renderer lifecycle is owned by a shared `useLspLifecycle`. `RL-027` Slice 1.5 is shipped; only Slice 1.5b (conditional breakpoints + watch expressions behind security review) remains. These unblock `RL-042` and `RL-047`.
8. **Runtime mode expansion.** `RL-019` + `RL-020` land together — the worker scratchpad + browser preview story. Depends on `RL-033` stabilization landing first if Vite is touched.
9. **Notebook + rich output.** `RL-043` + `RL-044` are a paired slice. Only after the runtime contract from §4 is stable.
10. **Personalization + lessons.** `RL-039` in-app lesson browser, `RL-041` static export.
11. **Growth / SEO / marketing / docs IA.** `RL-066` closed 2026-05-05 (six SEO sub-pages live in EN+ES on `linguacode.dev`; ranking-window measurement deferred to post-launch tracking, not engineering-blocking). `RL-082` closed 2026-05-05 (README slim-down + `DEVELOPMENT.md` + `USAGE.md`). `RL-032` continues as the remaining polish ticket in this lane after the core launch ships.

Never start a row tagged `Gated` until its gate clears. When the top of
this list is blocked, drop down the list rather than improvise.

## 6. Closed tickets (historical reference)

This section is intentionally compact — `Done` tickets are listed once,
without scope, so agents don't waste tokens scanning them. Deep
implementation detail lives in `docs/PLAN.md#RL-XXX`.

<details>
<summary><strong>63 `Done` tickets</strong> — expand for the list</summary>

`RL-001`, `RL-002`, `RL-003`, `RL-004`, `RL-005`, `RL-006`, `RL-007`,
`RL-008`, `RL-009`, `RL-010`, `RL-016`, `RL-017`, `RL-018`, `RL-021`,
`RL-022`, `RL-026`, `RL-028`, `RL-030`, `RL-034`, `RL-037`, `RL-038`,
`RL-040`, `RL-045`, `RL-051`, `RL-052`, `RL-053`, `RL-054`, `RL-055`,
`RL-056`, `RL-057`, `RL-058`, `RL-060`, `RL-061`, `RL-062`, `RL-063`,
`RL-064`, `RL-065`, `RL-066`, `RL-067`, `RL-068`, `RL-069`, `RL-070`,
`RL-071`, `RL-073`, `RL-074`, `RL-075`, `RL-076`, `RL-077`, `RL-078`,
`RL-079`, `RL-080`, `RL-081`, `RL-082`, `RL-083`, `RL-084`, `RL-085`,
`RL-086`, `RL-087`, `RL-088`, `RL-089`, `RL-090`, `RL-091`, `RL-092`.

</details>

<details>
<summary><strong>3 `Superseded` tickets</strong> — expand for the list</summary>

- `RL-013` — Hybrid JS/TS runtime modes → superseded by `RL-019`, `RL-020`, `RL-029`.
- `RL-014` — AI assistance → superseded by `RL-031`.
- `RL-015` — i18n, custom theming, and shortcut customization → superseded by `RL-018`, `RL-037`.

</details>

## 7. Status-update protocol (when closing a ticket)

The last commit of a ticket must do all three:

1. Flip `Status` in the matching row of §4 to `Done` and append a
   2-3 line "Shipped: …" summary to the scope cell. Move the row into
   the §6 archive if the ticket is fully closed.
2. If the ticket had a corresponding entry in `docs/SPRINT-PLAN.md` §1
   (Status-at-a-glance) or a detailed §N section, shrink that section
   to a one-line "Shipped on <date> — see RL-XXX" reference.
3. If the ticket's original scope claims in `docs/PLAN.md` now drift
   from reality, add an "### §X Status Update" block inside that
   RL-XXX section with the new state — do not rewrite history.

If the ticket introduced new docs (ADR, runbook, spec), register them
in `docs/README.md` under the appropriate index row.
