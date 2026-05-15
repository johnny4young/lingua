# Lingua — docs index

All long-form engineering documents live in this folder. Code-level docs
stay inside `src/`; user-facing product docs live on linguacode.dev and
are not part of this repo.

## Planning — the four-doc layer

The repo's planning state is split across four files on purpose, so
agents and humans can load only the cheapest file that answers their
current question. **Every planning artefact lives in these four files —
no external plan directory, no `.claude/plans/*`, no machine-local
state.** If it is not in git, it does not count.

| File                                 | Role                                                                                                                                                 | Read when                                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [`ROADMAP.md`](./ROADMAP.md)         | Canonical status + priority for every `RL-XXX` ticket. One compact table.                                                                            | You need to know _what is the current state_ or _what to pick next_. **This is the cheapest file — always read it first.** |
| [`SPRINT-PLAN.md`](./SPRINT-PLAN.md) | Tactical per-commit detail for the 2–5 currently-active iters. Mirrors ROADMAP 1:1 but adds file lists + draft commit messages + edge-case matrices. | You are executing one of the active iters and need the per-commit sequence.                                                |
| [`PLAN.md`](./PLAN.md)               | Deep scope + acceptance criteria + historical reasoning for every `RL-XXX`. Large (~3k lines).                                                       | You need one ticket's deep scope. Grep the single `### RL-XXX` section; never load the whole file.                         |
| [`BACKLOG.md`](./BACKLOG.md)         | Pre-commitment raw ideas without acceptance criteria.                                                                                                | You are capturing a new idea, or checking whether an inbound request already has a bullet.                                 |

**Authority:** when two of these disagree, the order of truth is
`ROADMAP` > `SPRINT-PLAN` > `PLAN`. `BACKLOG` never contradicts the
other three — it contains nothing with acceptance criteria yet.

**Migration direction:**

```
BACKLOG → (graduate with acceptance criteria) → ROADMAP §4 as RL-NNN
  → (pick for current sprint) → SPRINT-PLAN §N
    → (ship) → ROADMAP §6 archive + SPRINT-PLAN §1 Status flip
```

Items never demote. Closed tickets stay closed.

## Reading order (new contributors)

1. [`DEVELOPMENT.md`](./DEVELOPMENT.md) — contributor workflow (clone, dev/test/smoke/build commands, Pro testing locally, automation/delivery).
2. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — process model (main vs. renderer),
   IPC filesystem bridge, watch-state, project lifecycle.
3. [`CAPABILITY_MATRIX.md`](./CAPABILITY_MATRIX.md) — which execution class
   (browser WASM, browser interpreter, WebContainer, desktop native, hybrid)
   owns each capability today. Don't propose WASM-first migrations outside
   the promotion rules listed there.
4. [`USAGE.md`](./USAGE.md) — end-user product reference (keyboard shortcuts, deep links, plugin format, browser-only limitations, update behavior).
5. [`ROADMAP.md`](./ROADMAP.md) — what is in progress right now and what
   the next ticket is.
6. [`PLAN.md`](./PLAN.md) — drill into specific `RL-XXX` sections when
   you need the deep context behind a decision.
7. [`TEST_PLAN.md`](./TEST_PLAN.md) — test strategy, coverage targets,
   how unit / component / Playwright / desktop smoke tests divide labor.
8. [`A11Y.md`](./A11Y.md) — accessibility quality gate: automated
   axe-core scans, keyboard-only flow tests, focus restoration, plus
   a manual screen-reader checklist for VoiceOver / NVDA.
9. [`PERFORMANCE.md`](./PERFORMANCE.md) — bundle/runtime budgets,
   local report commands, CI performance logs, and desktop smoke
   runtime/memory metrics folded into `runtimeObservability`.
10. [`RECOVERY.md`](./RECOVERY.md) — error boundaries, safe-mode
    boot (`?safe-mode=1`), boot-loop counter / factory mode, the
    Recovery surface in Settings → Account, and the manual recovery
    folder paths per platform.
11. [`PUBLIC_READINESS_AUDIT.md`](./PUBLIC_READINESS_AUDIT.md) —
    current public-source readiness, release/security gaps, and the
    pre-publication action queue.

## Architecture Decision Records (ADRs)

Each ADR captures one design call with context, alternatives, and the
decision. ADRs are **additive** — once filed they are not rewritten,
only superseded by a new ADR that names the one it replaces.

| ADR                                                | Scope                                                                                                                                                       | Owning RL task                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [`AI_BRIDGE_ADR.md`](./AI_BRIDGE_ADR.md)           | Three-tier AI access (local Ollama, BYO key, hosted credit pool); keychain integration; tier-by-tier matrix                                                 | v2.0 (no `RL-NNN` yet — graduates from BACKLOG when sized) |
| [`BUILD_SYSTEM_ADR.md`](./BUILD_SYSTEM_ADR.md)     | Stay on Electron Forge vs. move to electron-vite / electron-builder                                                                                         | `RL-034`                                                   |
| [`DEBUGGER_ADR.md`](./DEBUGGER_ADR.md)             | Debugger MVP — which backend and UI surface                                                                                                                 | `RL-027`                                                   |
| [`ENV_VARS_ADR.md`](./ENV_VARS_ADR.md)             | Environment variables for execution contexts (global / project / tab tiers)                                                                                 | `RL-011`                                                   |
| [`LANGUAGE_PACK_ADR.md`](./LANGUAGE_PACK_ADR.md)   | Declarative language-pack registry                                                                                                                          | `RL-038`                                                   |
| [`LICENSING_ADR.md`](./LICENSING_ADR.md)           | Vendor (Polar.sh), license-server stack, device-binding, trial, and release/update strategy                                                                 | `RL-059`, `RL-061`                                         |
| [`MARKETING_SITE_ADR.md`](./MARKETING_SITE_ADR.md) | Marketing site lives in a separate repo (`lingua-marketing`), Astro 6 + Tailwind v4 + Cloudflare Pages, auto-deployed to https://linguacode.dev from `main` | `RL-063`                                                   |
| [`RUNTIME_ASSETS_ADR.md`](./RUNTIME_ASSETS_ADR.md) | Vendoring + integrity-locking runtime assets (Pyodide); desktop offline posture; per-surface CSP rules                                                      | `RL-083`                                                   |
| [`RUNTIME_MODES_ADR.md`](./RUNTIME_MODES_ADR.md)   | Per-tab JS/TS runtime modes (Worker / desktop Node / Browser preview); Worker default, desktop Node subprocess contract, iframe preview sandbox             | `RL-019`                                                   |
| [`TAURI_SPIKE_ADR.md`](./TAURI_SPIKE_ADR.md)       | Tauri 2 feasibility spike                                                                                                                                   | `RL-035`                                                   |
| [`VIM_MODE_ADR.md`](./VIM_MODE_ADR.md)             | Vim mode integration inside the personalization slice                                                                                                       | `RL-037`                                                   |
| [`VITE_UPGRADE_ADR.md`](./VITE_UPGRADE_ADR.md)     | Vite major upgrade plan                                                                                                                                     | `RL-033`                                                   |

## Where things live

| If you need…                                                                                                                             | Go to                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Contributor workflow (dev/test/smoke/build commands, Pro testing locally)                                                                | [`DEVELOPMENT.md`](./DEVELOPMENT.md)                                                             |
| Keyboard shortcuts, deep links, plugin manifest format, browser-only limitations                                                         | [`USAGE.md`](./USAGE.md)                                                                         |
| The list of pending work                                                                                                                 | [`ROADMAP.md`](./ROADMAP.md)                                                                     |
| What a slice actually shipped                                                                                                            | the task's `Status` / scope cell in `ROADMAP.md`; use `PLAN.md` only for deep historical context |
| How two subsystems talk                                                                                                                  | [`ARCHITECTURE.md`](./ARCHITECTURE.md)                                                           |
| Whether a capability is web, desktop, or hybrid                                                                                          | [`CAPABILITY_MATRIX.md`](./CAPABILITY_MATRIX.md)                                                 |
| Why a non-obvious decision was made                                                                                                      | the matching `*_ADR.md`                                                                          |
| What we test and how                                                                                                                     | [`TEST_PLAN.md`](./TEST_PLAN.md)                                                                 |
| Accessibility quality gate (axe scans, keyboard flows, manual screen-reader checklist)                                                   | [`A11Y.md`](./A11Y.md)                                                                           |
| Bundle/runtime performance budgets and local report workflow                                                                             | [`PERFORMANCE.md`](./PERFORMANCE.md)                                                             |
| Recovery flows (error boundaries, safe mode, factory mode, reset surface)                                                                | [`RECOVERY.md`](./RECOVERY.md)                                                                   |
| Current public readiness audit and launch hardening queue                                                                                | [`PUBLIC_READINESS_AUDIT.md`](./PUBLIC_READINESS_AUDIT.md)                                       |
| Public repository publication checklist                                                                                                  | [`PUBLIC_RELEASE_CHECKLIST.md`](./PUBLIC_RELEASE_CHECKLIST.md)                                   |
| Public release security sign-off                                                                                                         | [`RELEASE_SECURITY.md`](./RELEASE_SECURITY.md)                                                   |
| Dated security review packets and remediation evidence                                                                                   | [`security/`](./security)                                                                        |
| macOS Developer ID signing and notarization setup                                                                                        | [`MACOS_SIGNING.md`](./MACOS_SIGNING.md)                                                         |
| Windows Authenticode signing setup                                                                                                       | [`WINDOWS_SIGNING.md`](./WINDOWS_SIGNING.md)                                                     |
| License + update server observability spec (metrics, alerts, dashboards)                                                                 | [`SERVER_OBSERVABILITY.md`](./SERVER_OBSERVABILITY.md)                                           |
| Operator runbooks (webhook replay, license recovery, refund handling, desktop update draft validation, update rollback, GitHub degraded, telemetry pipeline) | [`runbooks/`](./runbooks)                                                                        |
| Debugger MVP operator runbook (gutter UX, drawer mount, Settings rows, telemetry, TS source maps)                                        | [`DEBUGGER_SLICE1.md`](./DEBUGGER_SLICE1.md)                                                     |
| Launch / marketing collateral                                                                                                            | [`press-kit/`](./press-kit), [`seo-pages/`](./seo-pages)                                         |
| Student / classroom lesson drafts                                                                                                        | [`lessons/`](./lessons)                                                                          |

## Out of scope for this folder

- `CHANGELOG.md` lives at the repo root because the web + desktop builds
  read it at build time and surface it in the **What's New** overlay.
  It is a product surface, not an engineering doc.
- End-user installation, licensing tours, and feature walkthroughs live
  on linguacode.dev. The terse in-repo end-user reference (shortcuts,
  deep links, plugin format) lives at [`USAGE.md`](./USAGE.md).
- README is a concise entry point at the repo root; the deep contributor
  workflow (dev/test/smoke/build) lives in [`DEVELOPMENT.md`](./DEVELOPMENT.md).
- LICENSE / RELEASE / SECURITY / PRIVACY / CONTRIBUTING /
  THIRD_PARTY_NOTICES live at the repo root because they are npm /
  GitHub / public-release surfaces.

## Conventions

- Use Markdown. Keep line length loose (reflowable by editors).
- Every RL id in any doc must match an `RL-XXX` heading in `PLAN.md`.
- When an ADR supersedes another, add a `> Supersedes ADR-XXX` banner
  at the top of the new one and a `> Superseded by ADR-YYY` banner at
  the top of the old one.
- Dates use ISO format (`2026-04-22`) so sort order is correct.
