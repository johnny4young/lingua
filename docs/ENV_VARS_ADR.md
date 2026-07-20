# ADR — Environment variables for execution contexts

| Status | Accepted — implemented |
| ------ | ----------------- |
| Decision | Add a tab-overrides-project-overrides-global env-var stack for desktop child-process runners (Go, Rust, Python). JS/TS Worker mode and the web build remain env-var free. |
| Date | 2026-04-20 |
| Implementation status | Scope merging, persisted settings, the Settings UI, and Go/Rust/Python runtime wiring have shipped. |

## Runtime merge order

The Go compile path is the first runtime to consume the merged env end-
to-end. The merge order lives in `resolveGoCompileEnv` in
`src/main/go-compiler.ts` and is this, in order of increasing
precedence:

1. `process.env` (host — comes in via the main process, not via
   preload; preserves credentials and machine-specific values).
2. The user-space record composed by `useEnvVarsStore.resolveEffectiveEnv`
   in the renderer (global → project → tab).
3. Runner-owned keys (`GOOS=js`, `GOARCH=wasm` for Go) — these
   **cannot** be overridden by the user env. Writing them in the user
   tier is allowed (the implementation validator lets them through) but they
   get dropped during this final merge so the WASM build never breaks
   silently.

Non-string user values are dropped defensively at this step even though
`envVarsStore` already rejects them up front.

### Rust (shipped 2026-04-20 quater)

`resolveRustRunEnv` in `src/main/rust-compiler.ts` follows the same
two-tier merge — `process.env` underneath, user env on top — with one
intentional difference from Go: **there are no runner-owned keys**.
Rust's toolchain knobs are plain env vars (`RUSTC_WRAPPER`,
`RUSTFLAGS`, `CARGO_HOME`, etc.) that users legitimately want to set,
so we let them win over host values. The resolved env is passed to
both `execFileAsync('rustc', ...)` (compile tier) and
`spawn(binaryFile, ...)` (runtime tier) so the Rust program reads the
same env via `std::env::var` that the compiler saw.

### Python (shipped 2026-04-20 quinquies)

Python is the only implementation runtime that does NOT use a subprocess
— Pyodide runs in a Web Worker inside the renderer. The env crosses
via the `execute` postMessage payload (`userEnv` field) instead of
through `ipcRenderer.invoke`. Inside the worker, before user code
runs, a small Python preamble does:

```py
import os
os.environ.update(_LINGUA_USER_ENV)
```

`_LINGUA_USER_ENV` is set with `pyodide.globals.set(...)` and is
deleted right after the merge so it does not leak into user scope.
When the resolver returns an empty record (no tiers set), the
preamble is skipped entirely so the existing fast path stays
untouched. `os.getenv(...)` from user code reflects the merged
record exactly the way Go and Rust subprocesses see their env.

There is no `process.env` tier here — Pyodide has no host process
to read from, and the implementation contract explicitly keeps host env
out of the renderer. The merge is therefore "global → project →
tab" with no host underlay; that is honest about Pyodide's
sandbox.

## Context

The feature required three scoping decisions before implementation:

1. **Which runtimes receive env vars in desktop mode.**
2. **Which env vars (if any) exist in web mode.**
3. **Whether env vars are tab-scoped, project-scoped, or global.**

This ADR answers all three so the implementation steps can ship
without re-litigating the policy in every PR.

## Decisions

### 1. Runtimes that receive env vars

| Runtime | Receives env? | Why |
|---------|----------------|-----|
| Go (`go build` + WASM) | **Yes** — host-set env vars are forwarded to `go build` and merged into the WASM execution context where Go's `os.Getenv` can read them | Go users routinely depend on `GOOS`, `GOARCH`, `CGO_ENABLED`, `GOPROXY` |
| Rust (`rustc` + native subprocess) | **Yes** — env merged into `rustc` invocation and the spawned binary | Crates use env-driven build switches (`RUSTC_WRAPPER`, `RUSTFLAGS`); user code reads via `std::env::var` |
| Python (Pyodide Worker) | **Partial** — env exposed to Pyodide's `os.environ`-like shim, **not** propagated to the host process | Pyodide is in-renderer; there is no child process to propagate to. We surface the same dict so user snippets behave consistently across desktop and web |
| JavaScript Worker | **No** — Workers cannot read host env, and exposing `process.env` would be a misleading polyfill | Plan-explicit: "JS/TS Worker mode does NOT receive env" |
| TypeScript Worker | **No** — same as JS Worker | Same reason |

The IPC handlers in `src/main/go-compiler.ts` and
`src/main/rust-compiler.ts` already accept an env object via
`execFile`'s options; the renderer-side runners are the only side
that needs new code.

### 2. Web mode

**No env vars in web mode.** The browser sandbox has no host env
to read, and inventing a `window`-scoped polyfill would diverge
from the desktop semantics for the same code. The web adapter
will surface env-var attempts as `web-unavailable` (matching the
existing pattern for gofmt / rustfmt / crash reporter).

Pyodide on web does still get the user's typed env dict — that's
a renderer-only concept and works in both shells.

### 3. Scope: tab > project > global

Three tiers that merge with **tab > project > global** precedence:

- **Global** (`envVarsStore.global`) — persisted across sessions,
  shipped to every runner that accepts env. The default for "set
  `RUST_BACKTRACE=1` everywhere".
- **Project** (`envVarsStore.project[projectId]`) — persisted per
  project key (only editable when a project is open). The default for
  "this repo's `GOPROXY`".
- **Tab** (`envVarsStore.tab[tabId]`) — persisted in the local
  env-var store but intentionally excluded from profile export. The
  default for "I want to test what happens if `DEBUG=1` for one run."

A runner sees the **merged** env at execution time:

```
finalEnv = { ...processEnv, ...global, ...project, ...tab }
```

Tab keys override project, project keys override global, global
keys override the host env. Empty string is a real value (it
unsets the inherited variable for that run, matching POSIX
shell semantics).

The merge happens in a new pure helper
`src/shared/envVarScopes.ts` so renderer + main can reason about
it the same way (the renderer for the UI, main for the IPC
handler that builds the `execFile` options).

## What stays out of this ADR

- **No secret transport outside the declared scopes.** The resolver only
  consumes the host, global, project, and tab tiers documented here.
- **No secret-storage UI.** Env vars persist in plain JSON in
  localStorage / on disk. Users who want secrets should use the
  host shell or a vault — Lingua is a scratchpad, not a vault.
  Settings copy MUST flag this explicitly when the UI lands.
- **No `.env` file ingestion** in the initial implementation. The `.env`
  validate-only mode is editor-only and intentionally
  does not feed the runner env. A future "import .env" button is
  tracked under `Future` follow-ups.
- **No global → project → tab precedence inversion** as a setting.
  The merge order is fixed; a future ADR can revisit if customer
  feedback reveals the inverse is more useful.

## Implementation status

### Pure scope merger

- `src/shared/envVarScopes.ts` — types + the
  `mergeEnvScopes(scopes)` pure function. Empty string preserved.
  Unicode key validation (POSIX-name regex). Hard cap at 100 keys
  per scope to keep merge cost bounded.
- `tests/shared/envVarScopes.test.ts` — merge precedence, empty
  string overrides, key validation, cap enforcement.

### Settings, project, and tab plumbing

- `src/renderer/stores/envVarsStore.ts` owns all three user tiers
  (`global`, `project[projectId]`, `tab[tabId]`) under the
  `lingua-env-vars` localStorage key. The store sanitizes every tier
  on write and again on rehydrate.
- Profile import/export uses the same store-level shape: global +
  project scopes are portable; tab-scoped env vars are not exported.
- Runtime runners ask the store for `resolveEffectiveEnv(...)` at
  execute time and hand the merged user record to the runtime-specific
  bridge.

### Settings UI

- `EnvVarsSection` in Settings exposes the global/project/tab tiers
  with the secret-storage warning from this ADR.
- The project tier is available when a project is open; otherwise the
  Settings row explains why no project scope can be edited.
- The tab tier is bound to the active editor tab and is intentionally
  excluded from profile export.
- i18n: labels, validation feedback, column headers, and warning copy
  live in both English and Spanish locale files.

### Honest web-mode limit

- Web mode still has no host `process.env` tier. Renderer-owned user
  env values can flow into Pyodide because that runtime is already
  renderer-local; Go/Rust host env forwarding remains desktop-only.

## Verification matrix (for the implementation steps, not this ADR)

With the implementation shipped:

1. Define a global env var `DEMO=global` and a tab env var
   `DEMO=tab`. Run the active tab — expect Go/Rust/Python to see
   `DEMO=tab` (tab wins).
2. Define `EMPTY=''` at the tab tier. Confirm the runner does
   **not** see `EMPTY` from the host process — the empty value
   masks the inherited variable.
3. Open the web build and try to define an env var — expect the
   Settings UI to render but the runner-side notice to surface
   "desktop only".
4. Define an invalid key (`123FOO`, `WITH SPACE`, etc.) and
   confirm the validator rejects it before persistence.
5. Run `pnpm run smoke:desktop` to confirm Go and Rust still
   execute correctly when no env vars are defined (regression
   protection for the merge plumbing).

## When to revisit

Open a successor ADR when **any** of these becomes true:

1. A customer needs the inverse precedence (global > project > tab).
2. Secret-storage demand grows beyond the current "Lingua is a
   scratchpad" boundary — at that point a proper vault integration
   ADR is the right path, not bolting it onto envVars.
3. Pyodide ships native `os.environ` parity that requires a
   different shim than today's renderer-injected dict.
4. WebContainers ship and grow a real Node environment in
   the browser — that flips the web-mode answer.

## Cross-links

- `BUILD_SYSTEM_ADR.md` — unchanged. Stay-on-Forge means env
  forwarding goes through the existing `execFile` IPC path.
- `CAPABILITY_MATRIX.md` — env vars become a new row in the
  shell-feature matrix when implementation ships ("Hybrid: desktop-native
  for child processes, renderer-only for Pyodide").
- `LANGUAGE_PACK_ADR.md` — implementation's `LanguagePack` already
  carries the runtime-deps array; implementation can hang an
  `acceptsHostEnv: boolean` capability flag on the same descriptor
  if needed.
- internal in the implementation notes — flips from `Planned` to `Partial` once this
  ADR lands, with the implementation steps unblocked.

## Reviewers

- First recorded decision: 2026-04-20.

Future revisits leave a dated entry rather than overwrite, so the
history of why each scope decision was made stays auditable.
