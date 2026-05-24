# Dependency Manager — ADR

> Decision record for the dependency adapter contract introduced in
> RL-025 Slice A. Lives under `docs/` next to the other ADRs so the
> reasoning stays close to the surface it changed.

## Context

Lingua executes user code in several runtimes (browser worker JS/TS,
Pyodide Python, desktop Node subprocess, Go / Rust compilers). Every
runtime has its own package ecosystem (`npm` / `pip` / `gem` / `go
mod` / `cargo`). Without language-aware dependency handling, a paste
of `import { sortBy } from 'lodash'` either silently fails at run
time (no resolver), or the renderer has to bake registry-specific
logic into the editor surface (no abstraction).

The original v2.0 product proposal called for "automatic install on
import detection". That direction is unsafe as written — a regex
sweep would miss comments/strings, and a silent install would mutate
the user's project (or the wrong project — Lingua's multi-tab
shell makes "the project" ambiguous when the user is editing two
unsaved scratchpads alongside a real folder). Plus auto-install over
a typo (`from numpyy import x`) is hard to recover from.

## Decision

Ship dependency management as an **explicit, language-adapter-driven**
pipeline split into three slices:

1. **Slice A (this one) — detection + classification + read-only UI.**
   Pure detector per language; main-side `existsSync` check against
   `node_modules`; bottom-panel "Dependencies" tab; Install button
   renders but stays disabled. No install path runs.
2. **Slice B — JS/TS desktop install via main-process spawn.** Adds
   an `installJs` adapter method; main spawns the package manager
   inside the resolved `cwd` with `shell: false` and a validated
   argv; output streams to a scrollable panel.
3. **Slice C — Python web install via `micropip`.** Adds an
   `installPython` adapter that calls `micropip.install()` inside
   the Pyodide worker; the bridge surfaces `unsupported` for
   native-wheel rejections honestly.

Deferred slices (Python desktop virtualenv, Ruby Bundler, Go
modules, Rust crates, JS/TS WebContainer installs) reuse the same
adapter interface; promotion rules below pin when each unlocks.

### Adapter contract

```ts
interface DependencyAdapter {
  language: 'javascript' | 'typescript' | 'python';
  detect(source: string): DetectedDependency[];
}
```

- `detect()` is **pure** — no globals, no async, no IPC, no worker
  round-trip. Memoised by content hash so the cost only fires on real
  edits. Implementations swallow parser failures and return whatever
  was extractable before the parser gave up.
- Classification (`detected` / `installed` / `installing` / `failed`
  / `unsupported` / `needs-desktop`) lives **outside** the adapter
  because it depends on runtime state (`node_modules` existence,
  Pyodide loaded packages) the detector cannot see. Slice B/C
  extends the renderer-side classifier to transition `detected →
  installing → installed / failed`.
- Slice A web build short-circuits JS/TS to `needs-desktop` (web has
  no `node_modules`) and Python desktop to `needs-desktop` (no
  virtualenv slice yet). Honest degradation per
  `docs/CAPABILITY_MATRIX.md`.

### Anti-feature: silent installs

`docs/ANTI_FEATURES.md` already bans surprise mutations. The
dependency pipeline obeys that landmine:

- Detection NEVER triggers installation. The Install button is the
  only path; in Slice A it stays disabled.
- Slice B requires an explicit user action before any network or
  filesystem mutation: a per-package Install click, a short-window
  batch formed from multiple deliberate row clicks, or the visible
  "Install all" button. Detection alone never installs anything.
  The resolved cwd must contain `package.json`; otherwise the UI
  disables the action and main refuses to spawn. Slice C will follow
  the same explicit-action rule for `micropip`.
- No global `npm install -g` / no `pip install --user`. Project
  isolation is the contract.

### Privacy

Detection never sends the package list off-device. An explicit
install action necessarily sends the selected package names to npm
(Slice B) or the Pyodide package index (Slice C). Telemetry still
ships only a **bucketed count** (`'0' / '1' / '2-5' / '6-10' /
'>10'`) and the language id — never package names, source, file
paths, or install logs. The Privacy + Trust dashboard registers
`dependencies` as a feature row so the network audit table tracks
the install-path call separately.

## Coupled invariants

- `src/shared/dependencies/types.ts` owns `DependencyStatus`
  (closed enum) + `DEPENDENCY_COUNT_BUCKETS`. Mirrored in
  `src/shared/telemetry.ts` (`DEPENDENCY_COUNT_BUCKETS_SET`) and
  `update-server/src/telemetry.ts` (`DEPENDENCY_COUNT_BUCKETS`).
  Parity test in `tests/shared/telemetry.test.ts` enforces all
  three stay aligned.
- `src/main/dependencies.ts#resolveJsDependencyBatch` re-validates
  the specifier regex inside main so a compromised renderer
  cannot probe arbitrary filesystem paths. The relative-path
  guard ensures the joined `node_modules/<name>` stays inside the
  resolved cwd.
- Settings → Editor → "Auto-detect dependencies" master toggle
  short-circuits the hook AND clears the per-tab cache so the
  panel hides immediately, not after the next edit.

## Rollback

Slice A is additive: turning the master toggle OFF disables the
entire pipeline (no telemetry, no panel, no IPC). The detector code
stays loaded but never runs. Rollback the slice = revert the commit;
no migration, no persistence cleanup.

If Slice B/C surfaces a real regression after release, set the
master toggle default to `false` and ship a hotfix; the install
buttons are already disabled in Slice A so the rollback story is the
same as the disabled-detection path.

## When to revisit — promotion rules for the deferred adapters

(Borrowed pattern from `docs/CAPABILITY_MATRIX.md` § "Promotion
rules"; each row is a concrete observable that earns the next
adapter slice.)

| Adapter            | Promotion trigger                                                                                          |
|--------------------|------------------------------------------------------------------------------------------------------------|
| Ruby / Bundler     | Ruby telemetry (`runtime.ruby_runner_dispatched`) shows ≥5% of desktop runs hitting `'system'` (RL-042 Slice 6 already ships the signal). |
| Go modules         | Go LSP usage stays consistent in `language_scorecard_viewed` for ≥30 days AND ≥3 users file an issue mentioning missing module resolution. |
| Rust crates        | Same shape as Go modules — sustained Rust LSP adoption + 3 explicit issue reports for crate resolution.    |
| Python desktop venv | Python adoption on desktop builds passes web Python adoption AND a user can show a real workflow (data-science) blocked by the missing path. |
| JS/TS WebContainer | RL-029 spike promotes out of `Research-backed spike` (the WebContainer ADR is the gate; install slice rides on top). |

Each promotion writes a new "When to revisit" entry back here +
ships a slice that extends `DependencyAdapter` with `install(spec)`
under the same adapter discipline. No new schema, no new closed-enum
churn beyond the status transitions Slice B/C already plumb.

## References

- `docs/PLAN.md` § RL-025 — full slice scope + AC.
- `docs/ROADMAP.md` § 4d — current status.
- `docs/ANTI_FEATURES.md` — the "no silent installs" landmine.
- `docs/CAPABILITY_MATRIX.md` — adds a "Dependency management" row
  in Slice A so the matrix stays the canonical execution-class map.
