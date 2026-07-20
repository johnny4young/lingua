# Python notebook kernel — cross-cell state ADR

**Status:** Accepted — implemented (worker per-scope namespace + runner/session wiring + UI reuse of Restart kernel)
**Related:** notebook runner, Pyodide worker, and SQL-cell architecture

## Context

Notebook Python cells run through `runNotebookCell` →
`runnerManager.execute('python', …)` → the singleton `PythonRunner`
(`src/renderer/runners/python.ts`) → the persistent Pyodide worker
(`src/renderer/workers/python-worker.ts`). Two facts drive this design:

1. **There is exactly one Pyodide worker for the whole app.** `PythonRunner`
   holds a single `this.worker`, created lazily and shared by the editor
   scratchpad, the dependency installer, and every notebook cell. Pyodide is
   loaded once (~seconds, tens of MB).
2. **The worker never clears user globals between runs.** Every `execute`
   runs `runPythonAsync(userCode)` against the same `globals()`; only
   `os.environ` keys are reconciled between runs (worker line ~868). So Python
   state already persists across runs — but **globally and accidentally**:
   variables from the editor scratchpad, notebook A, and notebook B all land
   in the same namespace and leak into each other. The notebook docs call
   Python cells "independent per cell", which is true only of the JS
   `_sessionDelta` sandbox channel — it is **not** true of the Python
   namespace, which is a shared free-for-all today.

Desktop and web both use this same Pyodide worker (there is no native-CPython
execution path — `docs/CAPABILITY_MATRIX.md`'s "native (desktop)" note is
about asset resolution, not a separate interpreter). So one design covers both
platforms.

implementation's goal: **intentional, isolated per-notebook Python state** — cells within
one notebook share a namespace (so cell 2 sees cell 1's `import pandas as pd`
and `df`), while notebook A, notebook B, and the editor scratchpad stay
isolated from each other. Plus an explicit **Restart kernel** that clears one
notebook's namespace.

## Decision

**Per-notebook namespace dict on the single shared worker.** Keep one Pyodide
runtime; give each execution scope its own Python `dict` and run user code with
that dict as its globals. Isolation is a dictionary lookup, not a second
interpreter.

- The worker holds `Map<scopeId, PyNamespace>`. `scopeId` is the notebook
  **tabId** for a notebook cell (all cells in one notebook share one
  namespace). The **editor scratchpad passes NO `scopeId`** and stays on the
  legacy module-`globals()` path — its behavior is unchanged, and there is no
  reserved scratchpad scope in the implementation.
- `execute` gains an optional `scopeId`. When present, the worker seeds a fresh
  namespace dict for that id on first use (pre-populated with the same
  preamble bindings the current run installs — `print` capture, rich-media
  emit hooks, stdout/stderr redirection helpers) and runs the user code via
  `runPythonAsync(code, { globals: namespaceProxy })`. Absent `scopeId` keeps
  the legacy `globals()` path byte-for-byte (zero risk to the editor).
- A new `reset-scope` worker message drops `Map[scopeId]` → next run starts
  clean. That is **Restart kernel**.
- Reassignment semantics: **last write wins**, which falls out of
  `exec`-into-a-dict for free (`x = 1` in a later cell rebinds `x`). Matches
  the JS sandbox's "later cell shadows earlier" rule and Jupyter intuition.

### Isolation guarantees

| Runs in… | Share Python state? |
|---|---|
| two cells of the **same** notebook | **yes** (the feature) |
| notebook A vs notebook B | no |
| any notebook vs the editor scratchpad | no |
| after **Restart kernel** on notebook A | A's namespace is empty; B/scratchpad untouched |

Tab close disposes the notebook session (`disposeNotebookSession`) and must
also send `reset-scope` so a closed notebook's namespace does not linger in the
worker (memory + a reopened same-id tab starting dirty).

## Alternatives considered

- **One Pyodide worker per notebook.** True process-per-kernel isolation
  (closest to Jupyter). Rejected: each worker re-loads Pyodide (seconds + tens
  of MB) — opening three notebooks would triple the memory and load cost in a
  browser tab. The namespace-dict approach gives the same observable isolation
  at the cost of one dict per notebook.
- **Keep the accidental global sharing and just document it.** Rejected: it is
  a correctness/privacy problem (notebook A's `secret = …` visible to notebook
  B and the scratchpad), not a feature.
- **Serialize/replay a namespace delta like the JS sandbox.** Rejected: Python
  objects (DataFrames, models, open handles) are not JSON round-trippable; the
  whole point of a persistent kernel is that they survive between cells.

## Implementation sketch

1. **Worker** (`python-worker.ts`): add `scopeId` to the `execute` payload;
   maintain `const scopes = new Map<string, PyProxy>()`; factor the preamble so
   it can seed either `globals()` (legacy) or a scope dict; run user code with
   the scope dict as globals; add `reset-scope` handler. The scope-snapshot
   (variables panel) reads from the scope dict when present.
2. **Runner** (`python.ts`): thread an optional `scopeId` through `execute`
   and a `resetScope(scopeId)` method that posts `reset-scope`.
3. **Notebook session** (`notebookSession.ts`): pass `request.tabId` as
   `scopeId` for Python cells; drop the "independent per cell" caveat.
   `disposeNotebookSession(tabId)` calls `resetScope(tabId)` — and since the
   existing **Restart kernel** store action (`restartNotebookSession`) and
   `editorStore.removeTab` both already route through `disposeNotebookSession`,
   restart + tab-close reset the scope for free; no new session API is added.
4. **UI**: no new control — the notebook toolbar already has a "Restart kernel"
   button, so implementation only wires the reset through the existing dispose path.
   Update the Python cell hint ("shares state with other Python cells in this
   notebook") in i18n en/es (neutral LatAm tuteo).
5. **Docs**: flip the `CAPABILITY_MATRIX.md` notebook row + a CHANGELOG entry.

## Testing

- **Runner/worker unit** (mockable at the worker-message seam): two cells in
  one scope share a binding; two different scopeIds do not; `reset-scope`
  clears; absent `scopeId` preserves legacy behavior.
- **Notebook session**: `runNotebookCell` for Python passes tabId as scopeId;
  the existing Restart kernel action (`restartNotebookSession` →
  `disposeNotebookSession`) posts the reset; tab close resets.
- **Component**: Restart-kernel button renders + i18n resolves.
- **Web smoke** (Pro session, since notebooks are entitlement-gated): a Python
  cell defines `x`, a later cell prints `x`, Restart kernel clears it, and a
  second notebook does not see `x`. End with zero console errors.

## Risks / open questions

- **Preamble coupling.** The worker preamble is intricate (rich media, print
  patching, displayhook, scope snapshot). Running it against a per-scope dict
  instead of `globals()` is the main implementation risk; the legacy
  `globals()` path stays the default so the editor is never destabilized.
- **Loop protection & timeouts** already operate per-run and are scope-agnostic
  — no change.
- **Memory.** One dict per open notebook with Python cells. Bounded by the
  existing tab budget; tab close frees it via `reset-scope`.
- **Desktop.** Same Pyodide worker, so no extra work — but the desktop web
  smoke can't run in CI (entitlement gate); the Pro web smoke covers the flow.

## Rollout

Single PR (web-validatable). Not a draft — the whole path runs in the Pyodide
worker on both platforms, so the Pro web smoke is sufficient runtime
verification.
