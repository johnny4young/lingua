# Lingua — Roadmap

> **Updated:** 2026-05-02
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
| [`RL-063`](./PLAN.md#rl-063-download-landing-page-at-linguacodedev) | Download landing page at linguacode.dev | `Planned` | Static marketing page with OS-aware download + pricing. Re-scoped around the new `lingua-marketing` repo (BACKLOG entry, 2026-04-30) so the dedicated Astro+CF Pages site at `linguacode.dev` covers Home, Features, Pricing, Docs, and the "Go to app" link to `app.linguacode.dev`. |

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
| [`RL-026`](./PLAN.md#rl-026-add-language-intelligence-beyond-monacos-built-in-jsts-services) | Language intelligence beyond Monaco | `Planned` | Adapter for richer diagnostics/completion/hover/signature help per language. |
| [`RL-027`](./PLAN.md#rl-027-add-debugger-mvp) | Debugger MVP | `Partial` | ADR landed; JS/TS first implementation slice still pending. |
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
| [`RL-069`](./PLAN.md#rl-069-devutils-class-productivity-layer-for-the-utilities-workspace) | DevUtils-class productivity layer | `Planned` | Smart input auto-detection, recent-inputs history, cross-tool piping. |
| [`RL-072`](./PLAN.md#rl-072-specialty-utilities--qr--string-inspector) | Specialty utilities — QR + inspector | `Partial` | String Inspector shipped. QR code generate shipped on 2026-04-23 (PNG + download + L/M/Q/H levels). Remaining: QR code read mode (camera vs upload decision pending). |

### 4f. Launch operations (P1)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|
| [`RL-064`](./PLAN.md#rl-064-launch-asset-kit-phase-2) | Launch asset kit | `Partial` | Screenshots + press-kit drafted. Remaining: 60-second demo video + press templates. |
| [`RL-065`](./PLAN.md#rl-065-privacy-respecting-launch-telemetry) | Privacy-respecting telemetry | `Partial` | First-run consent + event allowlist + overlay.opened / runner.executed / feature.blocked wired. Remaining: event export pipeline. |
| [`RL-066`](./PLAN.md#rl-066-seo-landing-pages-for-language-specific-intents) | SEO landing pages | `Partial` | `seo-pages/` drafts landed. Remaining: build step that promotes drafts into linguacode.dev sub-routes. |
| [`RL-080`](./PLAN.md#rl-080-release-grade-desktop-ci-and-update-validation-gates) | Release-grade desktop CI + update gates | `Planned` | Promote package smoke, signing/notarization, update-feed checks, audit, and checksums into release automation. |
| [`RL-081`](./PLAN.md#rl-081-launchlegalsource-available-documentation-cleanup) | Launch/legal/source-available docs cleanup | `Planned` | Align source-available posture, Shepherd licensing, legal/privacy/security docs, and launch copy. |
| [`RL-084`](./PLAN.md#rl-084-local-plugin-manifest-hardening) | Local plugin manifest hardening | `Planned` | Enforce manifest schema, runtime allowlist, compatibility validation, diagnostics, and no arbitrary plugin code. |
| [`RL-085`](./PLAN.md#rl-085-sbom-and-third-party-license-compliance) | SBOM + third-party license compliance | `Planned` | Generate release SBOM, third-party notices, and license-policy gates for commercial distribution. |

### 4g. Personalization and surface polish (P2)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|
| [`RL-039`](./PLAN.md#rl-039-add-guided-lessons-docs-and-app-galleries-for-students) | Guided lessons + app galleries | `Partial` | Guided tour (Shepherd) + seeded lesson drafts in `docs/lessons`. Remaining: in-app lesson browser + progression. |
| [`RL-041`](./PLAN.md#rl-041-add-static-site-export-and-one-click-publish-for-web-projects) | Static site export + publish | `Planned` | Export JS/TS/HTML projects as self-contained static ZIP; one-click publish to GitHub Pages. |
| [`RL-046`](./PLAN.md#rl-046-add-gamification-achievements-and-progress-tracking-for-students) | Gamification + achievements | `Planned` | Achievement catalog, per-user progress, streaks. |

### 4h. Documentation and repo hygiene (P2)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|
| [`RL-082`](./PLAN.md#rl-082-readme-and-docs-information-architecture-cleanup) | README + docs information architecture cleanup | `Planned` | Split README into concise entry point plus indexed development, release, security, privacy, and licensing docs. |

### 4i. Security, resilience, and product quality (P2)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|
| [`RL-086`](./PLAN.md#rl-086-performance-budgets-and-bundleruntime-observability) | Performance budgets + runtime observability | `Planned` | Add bundle/runtime budgets, cold-start metrics, worker lifecycle measurements, and CI regression reporting. |
| [`RL-087`](./PLAN.md#rl-087-watcher-reliability-and-filesystem-edge-case-suite) | Watcher reliability + filesystem edge cases | `Planned` | Validate watcher lifecycle, bursts, renames, permissions, symlinks, path casing, and platform limitations. |
| [`RL-088`](./PLAN.md#rl-088-accessibility-qa-hardening) | Accessibility QA hardening | `Planned` | Add automated and manual accessibility checks for shell, overlays, file tree, editor, results, and utilities. |
| [`RL-089`](./PLAN.md#rl-089-user-profile-backup-export-and-restore) | User profile backup/export/restore | `Planned` | Versioned profile export/import for safe user-owned settings, snippets, shortcuts, themes, layout, and env vars. |
| [`RL-090`](./PLAN.md#rl-090-error-boundaries-and-recovery-ux) | Error boundaries + recovery UX | `Planned` | Add shell error boundaries, safe-mode boot, reset flows, redacted error export, and support recovery docs. |
| [`RL-091`](./PLAN.md#rl-091-license-and-update-server-observability-and-runbooks) | License/update server observability + runbooks | `Planned` | Add metrics, redacted logs, alerts, and incident runbooks for licensing, recovery, webhooks, and update feeds. |
| [`RL-092`](./PLAN.md#rl-092-release-security-review-checklist) | Release security review checklist | `Planned` | Add security sign-off for Electron, preload/IPC, filesystem, runners, updater, licensing, telemetry, dependencies, and docs. |

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

1. **Security launch hardening.** `RL-077`, `RL-078`, `RL-079`, and `RL-083` are all closed (last closure 2026-05-04 — Slice 2 picked cache-first SW + documented "first Python load needs network" limitation as the chosen web strategy). The launch-blocker set is clear.
2. **Launch blockers.** Pull `RL-063` (linguacode.dev download page) next. `RL-061` shipped fully on 2026-04-30 (now in §6 archive). `RL-059` stays `Partial` only as the historical parent for verifier + bridge work now shipped.
3. **Release, legal, and compliance readiness.** `RL-080`, `RL-081`, `RL-085`, and `RL-092` should land before a public launch announcement so packaged builds, update feeds, signing/notarization, source-available posture, privacy/security docs, third-party notices, dependency licensing, and release security sign-off agree.
4. **Runtime/platform surface hardening.** `RL-084`, `RL-087`, and `RL-091` harden the local plugin model, watcher reliability, and backend operations after the core launch blockers are under control.
5. **Product quality and supportability.** `RL-086`, `RL-088`, `RL-089`, and `RL-090` add performance budgets, accessibility QA, profile backup/restore, and recovery UX.
6. **Utilities polish.** `RL-068` / `RL-072` remaining slices — short cycles, isolated to Developer Utilities, no cross-cutting risk. Good warm-up work when blocked on a launch item.
7. **Debugger + language intelligence.** `RL-027` Slice 1 (JS/TS debugger minimal) and `RL-026` adapter layer. These unblock `RL-042` and `RL-047`.
8. **Runtime mode expansion.** `RL-019` + `RL-020` land together — the worker scratchpad + browser preview story. Depends on `RL-033` stabilization landing first if Vite is touched.
9. **Notebook + rich output.** `RL-043` + `RL-044` are a paired slice. Only after the runtime contract from §4 is stable.
10. **Personalization + lessons.** `RL-039` in-app lesson browser, `RL-041` static export.
11. **Growth / SEO / marketing / docs IA.** `RL-032`, `RL-066`, and `RL-082` after the launch blockers ship so they aren't obsolete by then.

Never start a row tagged `Gated` until its gate clears. When the top of
this list is blocked, drop down the list rather than improvise.

## 6. Closed tickets (historical reference)

This section is intentionally compact — `Done` tickets are listed once,
without scope, so agents don't waste tokens scanning them. Deep
implementation detail lives in `docs/PLAN.md#RL-XXX`.

<details>
<summary><strong>45 `Done` tickets</strong> — expand for the list</summary>

`RL-001`, `RL-002`, `RL-003`, `RL-004`, `RL-005`, `RL-006`, `RL-007`,
`RL-008`, `RL-009`, `RL-010`, `RL-016`, `RL-017`, `RL-018`, `RL-021`,
`RL-022`, `RL-028`, `RL-030`, `RL-034`, `RL-037`, `RL-038`, `RL-040`,
`RL-045`, `RL-051`, `RL-052`, `RL-053`, `RL-054`, `RL-055`, `RL-056`,
`RL-057`, `RL-058`, `RL-060`, `RL-061`, `RL-062`, `RL-067`, `RL-068`,
`RL-070`, `RL-071`, `RL-073`, `RL-074`, `RL-075`, `RL-076`, `RL-077`,
`RL-078`, `RL-079`, `RL-083`.

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
