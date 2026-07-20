# ADR — JS/TS runtime modes

| Field   | Value      |
|---------|------------|
| Status  | Accepted   |
| Date    | 2026-05-12 |
| Implementation | Worker, Node, Browser Preview, Deno, and Bun are shipping |

## Context

Lingua's JS/TS execution today is a single sandboxed Web Worker
(`src/renderer/runners/javascript.ts`,
`src/renderer/runners/typescript.ts`). The Worker isolation is
deliberate — it gives every tab a predictable, fast, side-effect-free
scratchpad. But it costs reach:

| User intent                       | Today with Worker | Why it fails |
|-----------------------------------|-------------------|--------------|
| `document.querySelector('h1')`    | ❌ ReferenceError | No DOM inside Workers |
| `const fs = require('fs')`        | ❌ ReferenceError | No CommonJS / Node built-ins |
| `import axios from 'axios'`       | ❌ Unresolved import | No npm resolver inside the Worker |
| `JSON.parse(big).reduce(...)`     | ✅ Fastest path | Worker isolation is ideal here |

Users hitting any of the failing cases bail out to external
scratchpads, browser playgrounds, or terminal `node script.js`.
Lingua closes that gap
**without** losing the Worker speed for pure language work, by making
the runtime an explicit per-tab choice instead of one-size-fits-all.

The runtime model also unlocks two capabilities:

- The debugger surface can specialise breakpoint semantics
  per mode (Worker-only today; Node-mode breakpoints would land via
  the Node inspector protocol in future debugger work).
- Interactive REPL work depends on the per-tab runtime model
  to offer language-aware auto-run hints (Worker: instant; Node:
  warn on long-running fs operations; Browser preview: detect when
  to flush DOM mutations).

## Decisions

### 1. Five runtime modes, JS/TS only

| Mode               | Surface           | Status |
|--------------------|-------------------|-----------------------|
| `worker`           | Sandboxed Web Worker — no DOM, no Node built-ins | **Shipping** |
| `node`             | Desktop child-process Node with built-ins (`fs`, `path`, `http`) | **Shipping** |
| `browser-preview`  | Iframe-isolated context with DOM access + preview pane | **Shipping** |
| `deno`             | Desktop child-process Deno running JS/TS directly with temp-dir-scoped `--allow-read` | **Shipping** |
| `bun`              | Desktop child-process Bun running JS/TS directly with Lingua's native env allowlist | **Shipping** |

Other languages keep their existing single-runtime model. Adding
`runtimeMode` to a Python / Go / Rust tab is out of scope here; the
shared language-pack capability contract already covers their
runner identity. The shared helper `languageHasRuntimeModes()` gates
both the UI surface and the editor-store action.

### 2. Worker stays the default

Existing JS/TS tabs continue to run in the Worker. A user who never
touches the selector experiences zero behaviour change. The default
is enforced at three layers so a regression in any one of them
leaves the other two intact:

- `defaultRuntimeModeFor('javascript' | 'typescript') === 'worker'`
  in the pure helper.
- `createDefaultTab` consults the per-app `defaultRuntimeMode` from
  Settings but coerces to `'worker'` when the setting names an
  unimplemented mode.
- Session-store rehydrate (`coerceRuntimeMode`) snaps any unknown
  or unimplemented persisted value back to `'worker'` for JS/TS.

### 3. Disabled-with-tooltip vs hidden while a mode is unimplemented

The initial implementation shipped only `worker`. Two alternatives for the
remaining modes were considered:

a. **Hide the unimplemented options entirely.** Cleanest UX
   initially; defers discoverability until each backend is ready. Risk:
   users keep falling back to external scratchpads, terminal runs,
   or browser playgrounds because
   Lingua doesn't telegraph the roadmap.

b. **Render disabled with a clear "Coming soon" tooltip.**
   Slightly noisier UX; gives users a concrete schedule for the
   missing modes.

**Decision: option (b).** The audience is senior dev. They prefer
to see the roadmap and self-route to the right tool, even when the
"right tool" is "wait for the next runtime backend." The tooltip uses
plain product copy, while this ADR keeps the delivery detail.

Post-closeout note: Browser Preview shipped on 2026-05-12, Node mode on
2026-05-14, and Deno/Bun later joined as desktop-native JS/TS modes. The selector and Settings
default-mode select now show all five options enabled at the entitlement
gate; each desktop runner still self-gates on bridge availability and local
binary detection, so web builds and hosts without Deno/Bun degrade with a
clear runtime error rather than silently falling back to Worker.

### 4. No silent fallback to Worker

When a user tries to switch to an unimplemented mode (via shortcut,
palette, or programmatic call), the editor store rejects the write
and pushes a status notice. We do NOT silently fall back to
`worker` because that would (a) lie about the user's intent and
(b) make a future backend debut surprising. With all five backends shipping,
this branch is defensive for future enum additions rather
than an active Node-mode path.

### 5. Telemetry: closed enum, no expression content

`runtime.mode_changed` joins the `TELEMETRY_EVENTS` allowlist with a
strictly typed payload `{ mode, language }`. Both are closed enums
already on the allowlist. No file path, no source, no tab id, no
session id beyond the per-launch coarse identifier already attached
by the redactor.

Adoption metrics from this event drive prioritisation once additional
runtime backends are implemented. Tests validate the allowlist and
payload contract, but rejected attempts to select unimplemented modes
remain local status notices rather than telemetry so the event name
stays literal.

The closed-enum payload contract is the same shape used by the
debugger telemetry and the update funnel (`update.checked`). The pattern is now
load-bearing — see `docs/SERVER_OBSERVABILITY.md` for the worker
log-line envelope.

### 6. Runner dispatch stays language-keyed, with runtime overrides

The runner registry in `src/renderer/runners/manager.ts` continues
to dispatch by `language`. Worker mode routes `(language: 'javascript',
runtimeMode: 'worker')` to the existing JavaScript runner; the
contract surface for routing `(language: 'javascript', runtimeMode:
`'node')` to `NodeRunner` by extending the
registry with a runtime-mode override — not by hijacking the
language dispatch.

The reason: per-language plugin registration is the canon;
introducing a per-runtime registry now would double the surface
without payoff. Node mode uses a sibling `NodeRunner`; the dispatcher
gained a small runtime-mode map while the default language-keyed
path stayed intact.

## Consequences

**Positive:**

- Senior-dev users see Lingua's runtime ambition without us
  shipping half-functional modes.
- The telemetry contract supports additional runtime transitions.
- The contract surface is locked: `RuntimeMode` is a closed enum,
  the editor store and session store both coerce defensively, and
  the new helper `cycleRuntimeMode()` future-proofs the keyboard
  shortcut so new modes can land without re-wiring the
  shortcut catalog.

**Negative:**

- During early implementation, disabled future-mode options created some visual
  noise. This was temporary: all five known options are now enabled at the
  entitlement gate, and the disabled copy
  only protects future enum or detection gaps.

**Neutral:**

- Adding a runtime mode to other languages later (Python in a
  notebook context? Go in a desktop-only mode?) is structurally
  possible. The shared helper would extend its `JS_TS_LANGUAGES`
  set; everything else stays the same. Not in this ADR's scope.

## Implementation surface

| File                                                  | Purpose                                              |
|-------------------------------------------------------|------------------------------------------------------|
| `src/shared/runtimeModes.ts`                          | Pure helpers + closed enum                           |
| `src/renderer/types/index.ts`                         | `FileTab.runtimeMode?` + `SettingsState.defaultRuntimeMode` |
| `src/renderer/stores/editorStore.ts`                  | `createDefaultTab` + `setTabRuntimeMode` action      |
| `src/renderer/stores/sessionStore.ts`                 | Persist + rehydrate with `coerceRuntimeMode`         |
| `src/renderer/stores/settingsStore.ts`                | `defaultRuntimeMode` + `setDefaultRuntimeMode`       |
| `src/renderer/components/Toolbar/RuntimeModeSelector.tsx` | JS/TS-only dropdown                              |
| `src/renderer/components/Toolbar/Toolbar.tsx`         | Mount the selector behind a JS/TS guard              |
| `src/renderer/components/Settings/EditorSection.tsx`  | Default mode select                                  |
| `src/renderer/components/CommandPalette/commandPaletteModel.ts` | Runtime-mode palette entries (implementation note) |
| `src/renderer/runners/manager.ts`                     | Runtime-mode override map layered on top of the language-keyed registry |
| `src/renderer/data/keyboardShortcuts.ts`              | `Mod+Alt+M` shortcut entry                           |
| `src/renderer/hooks/useGlobalShortcuts.ts`            | Cycle dispatcher                                     |
| `src/renderer/App.tsx`                                | Cycle implementation                                 |
| `src/shared/telemetry.ts` + `update-server/src/telemetry.ts` | `runtime.mode_changed` event (implementation note)         |

## Deno and Bun extension ship notes — 2026-07-06

- `src/main/altJsRuntimes.ts` — desktop Deno/Bun backend. It writes
  source to a temp `.js` / `.ts` file, spawns without a shell, applies
  parent-owned timeout + output caps, and cleans up the temp directory.
  Deno is launched with `--allow-read=<tempdir>`; Bun has no equivalent
  permission model, so it relies on the same filtered environment posture as
  Node mode.
- `src/preload/index.ts` + `src/shared/ipcContract.ts` — expose
  `deno:*` and `bun:*` typed IPC channels in the desktop shell. The web
  adapter omits those bridges, so renderer runners surface a desktop-only
  error instead of dereferencing an unavailable API.
- `src/renderer/runners/altJsRunner.ts` — runtime-mode runner used for both
  Deno and Bun. It self-gates on bridge availability, binary detection, and
  the existing first-run native-runtime trust notice.
- `src/shared/runtimeModes.ts`, `RuntimeModeSelector`, Settings default mode,
  command-palette runtime switching, and telemetry parity all include
  `deno` / `bun` so persisted sessions and emitted events stay closed-enum
  safe.

## Node mode ship notes — 2026-05-14

### Architecture

- `src/main/node-runner.ts` — desktop main-process backend. It invokes
  `node` through `child_process.spawn` only, never a shell, and passes
  source either as `--input-type=<commonjs|module> -e <source>` for
  short buffers or as a temp `.cjs` / `.mjs` file for larger buffers.
- `src/preload/index.ts` — exposes `window.lingua.node.detect`,
  `window.lingua.node.run`, and `window.lingua.node.stop`. The web
  adapter deliberately omits this bridge, so `NodeRunner` reports a
  desktop-only error instead of dereferencing a missing IPC surface.
- `src/renderer/runners/nodeRunner.ts` — runtime-mode override used
  when a JavaScript or TypeScript tab selects `runtimeMode === 'node'`.
  TypeScript tabs transpile through `esbuild-wasm` before IPC; the
  execution context threads `language` and `filePath` so timeout
  presets and cwd resolution match the active tab.
- `src/renderer/runners/manager.ts` — keeps the normal language
  registry for Worker mode and adds a runtime-mode map for `node`
  and `browser-preview`.

### Process and sandbox contract

- **No shell interpolation.** User source is never concatenated into a
  shell command; it is either an argv element or a temp-file payload.
- **Filtered environment.** Main builds the subprocess env from
  `combinedAllowlist(NODE_TOOLCHAIN_KEYS)` plus the explicit internal
  user-env tiers. Host secrets such as API keys do not cross the IPC
  boundary by default.
- **Project-aware cwd.** Saved tabs use the nearest ancestor that owns
  a `node_modules/` directory, falling back to the saved file's
  directory. Unsaved tabs run from Electron's temp directory.
- **Parent-owned termination.** Each run carries a renderer-minted
  `runId`; Stop calls `node:stop` for that id, sends SIGTERM, and
  escalates to SIGKILL after 200 ms. The same ladder backs the
  timeout path.
- **Trust notice.** The first successful Node-mode run surfaces
  `runtimeMode.notice.firstRunDangerous` so users explicitly see that
  Node mode has full filesystem and network access.
- **Telemetry.** `runtime.node_runner_used` carries only
  `{ language, status }`, where status is the closed enum
  `success | error | timeout | stopped | missing-binary`.

## Browser Preview ship notes — 2026-05-12

### Architecture

- `src/renderer/runners/browserPreview.ts` — `BrowserPreviewRunner`
  implementing `LanguageRunner`. Owns the postMessage protocol
  with the iframe, the parent-side timeout kill, and the runId
  guard against stale / spoofed messages.
- `src/renderer/components/BrowserPreview/iframeBridge.ts` — pure
  module owning the bridge script template, the discriminator
  constant, the CSP string, and the document builder. Pure so the
  unit test asserts the generated payload directly.
- `src/renderer/components/BrowserPreview/BrowserPreviewPanel.tsx`
  — React surface that mounts the iframe element ref into the
  bridge so the runner can reach it.
- `src/renderer/runtime/browserPreviewBridge.ts` — module-level
  iframe-ref registry + tab activator. Mirrors the
  `debuggerWorkerBridge.ts` pattern so reviewers recognise the
  shape.

### postMessage protocol

Every message the bridge fires carries:

```
{ __lingua: 'browser-preview', runId, type, ...payload }
```

The parent (`BrowserPreviewRunner.execute`) rejects messages that
fail any of:

1. `event.origin` not in `{ 'null', window.location.origin }`.
2. `data.__lingua` is not the discriminator.
3. `data.runId` does not match the active run.

The discriminator is public (user code could read it from the
DevTools console of their own iframe) — the runId is the real
anti-spoof gate. UUIDs are minted via `crypto.randomUUID()` and
never reused across runs.

Bridge message types:

- `ready` — bridge installed, user code about to run. Parent
  treats this as a "the iframe is alive" probe.
- `console` — `{ method: 'log' | 'info' | 'warn' | 'error',
  args: string[] }`. Args are pre-serialized inside the iframe
  (`__linguaSerializeArg`) to match the JS Worker's serialization
  shape, so console output round-trips identically across
  runtimes.
- `error` — uncaught error: `{ message, source?, lineno?,
  colno?, stack? }`.
- `unhandledrejection` — Promise rejection: `{ message }`.
- `done` — execution complete. The trailing `<script>` posts this
  via a `Promise.resolve().then(...)` so any pending sync
  `console.*` flushes first.

### Iframe sandbox + CSP

- Iframe `sandbox="allow-scripts"` only. NOT `allow-same-origin`.
  Iframe sees its origin as `null`; `document.cookie` is empty +
  ignored; `localStorage` / `sessionStorage` throw on access. Our
  app origin / IPC bridge / Pyodide assets stay unreachable from
  user code.
- Inline CSP meta tag:
  `default-src 'none'; script-src 'unsafe-inline'; style-src
  'unsafe-inline'; img-src data:`.
  No `connect-src` → `fetch`/`XHR`/`WebSocket` blocked. No
  `frame-src` → nested iframes blocked. The `unsafe-inline` on
  script + style is intentional: user code IS the inline script,
  and implementation note (multi-file seed) injects a sibling `.css` tab as
  `<style>` inside the doc.

### Timeout kill

Parent owns `setTimeout(timeout)`. On fire, the parent assigns
`iframe.srcdoc = ''`, which the browser treats as a full
navigation — user code execution is terminated. The runner
resolves with `runnerTimeoutResult(...)` and detaches the
message listener.

### Multi-file preview seed

`executeTabManually` looks for sibling `.css` and `.html` tabs
in the editor store BEFORE calling `runnerManager.prepareRunner`.
If found, the runner's `setSiblingSources({ css, html })` push
threads them into the next `srcdoc`:

- `siblingCss` → `<style>` block in `<head>`.
- `siblingHtml` → injected literally as the `<body>` seed
  before the user-code script runs.

Both are optional; a JS-only tab still works.

### Inspect button

The panel's "Open in window" button (`browserPreview.inspect.*`)
serializes the current `iframe.srcdoc` as a top-level `data:` URL
and opens it in a new browser window with `noopener,noreferrer`.
Using `data:` keeps the inspected document on an opaque origin;
Blob URLs inherit the creator origin in Chromium and would let
preview code read Lingua's app-origin storage. Popup blockers can
refuse the open; the panel surfaces `browserPreview.inspect.blocked`
when that happens.

## CSP posture per runtime mode (audit)

This section is the per-mode CSP / sandbox contract that the
release security review consults.

| Mode | Origin | Network | DOM | Filesystem | Process | Notes |
|------|--------|---------|-----|------------|---------|-------|
| `worker` | Web Worker (same-origin) | Restricted by the app CSP; the JS runner does not call `fetch` from user code | None (`document` is `undefined` in a Worker) | None | None | The Pyodide worker for Python is a separate Worker with its own asset trust boundary; documented in `RUNTIME_ASSETS_ADR.md`. |
| `node`  | Desktop child process | Inherits the desktop network stack; first-run trust notice warns before adoption | None | Full Node `fs` API, with cwd scoped to the saved file's project directory or temp for unsaved tabs | Spawned via `child_process.spawn` with the Node env allowlist from `nativeEnv.ts`; Stop and timeout both SIGTERM then SIGKILL | Shipping as of 2026-05-14. Node permission flags remain follow-up hardening. |
| `browser-preview`  | iframe sandbox without `allow-same-origin` → effective origin `null` | Blocked by the srcdoc CSP `default-src 'none'` (no `connect-src`) | Full DOM inside the iframe; cannot reach the parent's DOM | None (no FSA inside an opaque-origin iframe; `localStorage` throws) | None | The parent assigns the bridge runId so spoofed `postMessage` from user code is rejected. |

The matrix is the reference for any future mode (for example, a
hypothetical WebContainer mode). Every new mode adds
a row before it lands a backend.

## Cross-references

- `CAPABILITY_MATRIX.md` — three new rows tracking per-mode
  availability per execution class.
- `DEBUGGER_ADR.md` § Coupled invariants — the debugger surface
  consumes `tab.runtimeMode` when a Node debugger
  backend.
- `src/main/node-runner.ts` — child-process timeouts and resource limits.

## Reviewers

- First recorded decision: 2026-05-12.
- Initial decision: 2026-05-12.
- Node backend: 2026-05-14.
- Browser Preview backend: 2026-05-12.

## Rollback

If the selector turns out to confuse users more than it helps:

1. Revert the Toolbar mount (`Toolbar.tsx` JS/TS guard) to hide the
   selector. The editor store, session store, telemetry, and
   command-palette entries can stay — they're inert without a UI
   entry point.
2. The `runtimeMode` field persisted on existing FileTabs remains
   harmless; the runner registry still dispatches by language so
   stale `runtimeMode: 'worker'` does nothing.
3. If we need to drop the data too: bump the session-store version
   and skip `runtimeMode` in the `merge`. Coverage in
   `tests/stores/sessionStore.test.ts` would need an entry for the
   version bump.

The selector can be removed independently because the runtime field is
defensively coerced during session rehydration.
