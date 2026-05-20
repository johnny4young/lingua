# Lingua v2.0 work proposal synthesis

> Status: research synthesis, not a fifth planning source.
>
> This document evaluates the v2.0 proposal work and maps the useful parts
> onto the current `RL-XXX` planning system. The executable source of truth
> remains:
>
> 1. `ROADMAP.md` for status and priority.
> 2. `SPRINT-PLAN.md` for current execution order.
> 3. `PLAN.md` for full acceptance criteria.
> 4. `BACKLOG.md` for raw ideas that are not implementation-ready.
>
> For the broader product-differentiation plan and the self-contained
> `WC-XXX` candidate tickets that came out of the same research pass, see
> [`WORLD_CLASS_PLAN.md`](./WORLD_CLASS_PLAN.md).

## Evaluation

The staged research is useful as a product-direction pass, but it is not
usable as-is as an engineering plan.

What survives:

- no-backend sharing is a strong first collaboration slice;
- rich console media belongs on top of the existing `RL-044` payload work;
- dependency management is valuable only when it is explicit, isolated, and
  language-aware;
- local-first AI stays aligned with Lingua's privacy positioning;
- visualization and notebooks are real differentiators once the output and
  runtime contracts stabilize.

What changed:

- The proposed new ticket IDs are removed. They contradicted the repo rule
  that current planning uses existing `RL-XXX` rows unless a new row is
  formally promoted in `ROADMAP.md` and `PLAN.md`.
- "Cryptographic sharing" is renamed. A compressed URL fragment is not
  encryption. It avoids a backend and the fragment is not sent in HTTP
  requests, but anyone with the link can read the content.
- Automatic package installation is rejected. The install path must be an
  explicit user action with a trust prompt, scoped working directory, and
  per-language installer adapter.
- WebGPU AI is deferred behind capability research. The first executable AI
  slice stays desktop-local Ollama through the existing `AI_BRIDGE_ADR.md`
  boundary.
- Algorithm visualization must use an explicit runtime API first, not
  regex-based loop injection. Regex injection is too brittle for JS/TS and
  cannot generalize to Python/Ruby without language-specific parsers.
- Notebook execution must use runner-owned sessions. `globalThis.eval()` in
  the renderer/worker would bypass the existing execution instrumentation and
  isolation assumptions.

## Promotion map

| Research proposal | Current ticket | Decision |
|---|---|---|
| URL-fragment / no-backend share links | `RL-036` | Keep as Phase A1 before `.linguashare` bundles. |
| Rich media console output and charts | `RL-044` | Keep as next rich-output slice after the Slice 1 payload foundation. |
| Zero-config package manager | `RL-025` | Keep, but make installs explicit and adapter-driven. |
| Privacy-first local AI | `RL-031` | Keep Ollama MVP first; WebGPU/BYO/hosted stay later phases. |
| Real-time data-structure visualizer | `RL-047` | Keep future-priority and gate on debugger + rich output + notebooks. |
| Polyglot notebooks | `RL-043` | Keep, but define `.linguanb` and session contracts before UI. |

## Recommended execution order

1. `RL-027` Slice 1.5b: finish debugger watch expressions and conditional
   breakpoints behind the security review already recorded in `ROADMAP.md`.
2. `RL-044` next slice: complete the rich-output renderer migration with
   chart, image, and sandboxed HTML payloads.
3. `RL-036` Phase A1: ship no-backend single-tab share links through URL
   fragments.
4. `RL-025` Slice A/B: ship dependency detection and explicit installs for
   JS/TS desktop plus Pyodide `micropip`.
5. `RL-031` Slice 0/1: ship the desktop-local Ollama bridge and the first
   constrained AI action surface.
6. `RL-043` Slice A: define `.linguanb`, parser, persistence, and JS/TS/Python
   per-notebook execution sessions.
7. `RL-047` Slice A: ship an explicit visualization payload API on top of
   `RL-044` and notebook sessions.

## Ticket briefs

These briefs are intentionally short. The full implementation-ready scope now
lives in each matching section of `PLAN.md`.

### `RL-036` Phase A1: no-backend share links

Goal: make a single active tab shareable without an account, database, or
cloud write.

Implementation boundaries:

- Add a pure codec module under `src/renderer/utils/` for schema validation,
  compression, base64url encoding, and decoding.
- Store only the active tab's language, name, content, runtime mode, workflow
  mode, stdin buffer, and safe per-tab workflow flags.
- Use `#code=<payload>` links for web and desktop deep-link handoff. Do not
  call this encrypted or private.
- Enforce a URL payload cap and show a localized error when content is too
  large.
- On decode, validate language and modes through the existing language-pack
  helpers before opening a tab.

Acceptance:

- A valid link opens a new tab with the expected language, code, runtime mode,
  workflow mode, stdin, and auto-log flag.
- Invalid, oversized, unsupported-version, or tampered payloads produce a
  status notice and never crash boot.
- No license token, absolute path, environment variable, or project identity
  is serialized.

### `RL-044` next slice: rich media console payloads

Goal: finish the console payload model so structured output can render as
tables, trees, charts, images, and sandboxed HTML without replacing the
existing text fallback.

Implementation boundaries:

- Extend the existing `src/shared/richOutput.ts` types instead of introducing
  a second payload shape.
- Keep JS/TS/Python on the current worker-owned console protocol.
- Add explicit helper APIs such as `lingua.chart(...)` and `lingua.html(...)`
  only after they map to the same `RichOutputPayload` contract as
  `console.table`.
- Render HTML in an iframe without `allow-scripts` or `allow-same-origin`.
- Use app theme tokens for charts and tables; no hardcoded low-contrast zinc
  palette.

Acceptance:

- Existing console output keeps working when rich rendering is disabled.
- Chart/image/HTML payloads render in the console panel and degrade to raw JSON
  in the detail popover.
- Sandbox tests prove scripts do not execute from HTML payloads.
- JS, TS, and Python each have at least one happy-path smoke for rich media.

### `RL-025` Slice A/B: explicit dependency management

Goal: make missing dependencies understandable and installable without silent
global mutation.

Implementation boundaries:

- Add a language adapter registry for dependency detection and installation.
- Detect imports with AST/parser-backed logic where available; use regex only
  as a fallback with documented limits.
- JS/TS desktop installs run through main-process spawn with `shell: false`
  and a project-scoped cwd.
- Python web installs use Pyodide `micropip` only for compatible packages.
- Python desktop virtualenv support is a separate later slice.
- Ruby gems and Bundler are deferred to a Ruby-specific adapter after the
  JS/TS and Python paths prove the contract.

Acceptance:

- The UI distinguishes detected, installing, installed, failed, unsupported,
  and needs-desktop states.
- Installing a JS dependency never runs automatically; the user must confirm.
- Package names and specifiers are validated before reaching main.
- Unsupported web and native paths fail with actionable copy, not runner
  crashes.

### `RL-031` Slice 0/1: local AI MVP

Goal: add a local-only desktop AI bridge without weakening the privacy story.

Implementation boundaries:

- Use the existing `AI_BRIDGE_ADR.md` as the long-term direction, but ship
  Ollama-only first.
- The renderer calls `window.lingua.ai.*`; it never calls Ollama HTTP
  endpoints directly.
- Main owns availability checks, prompt building, streaming, cancellation, and
  error normalization.
- The first UI exposes constrained tasks, not a permanent general chat:
  generate algorithm, explain current code, and translate idea to current
  language.
- WebGPU, BYO keys, and hosted credits stay out of the MVP.

Acceptance:

- Web mode clearly reports local AI as unavailable.
- Desktop mode can detect Ollama, list local models, stream one request, and
  cancel cleanly.
- Output is copied or inserted only after an explicit user action.
- No project-wide context or unrelated tabs are sent.

### `RL-043` Slice A: notebook foundation

Goal: define notebook files and execution sessions before building a large
notebook UI.

Implementation boundaries:

- Add a `src/shared/notebookDocument.ts` parser/serializer with a versioned
  `.linguanb` schema.
- Extend editor state with a tab kind for notebooks instead of overloading
  plain file tabs.
- Start with JS/TS/Python code cells and markdown cells.
- Use runner-owned session IDs per notebook tab; do not evaluate cells with
  raw `globalThis.eval()`.
- Virtualize editor cells so large notebooks do not mount dozens of Monaco
  instances at once.

Acceptance:

- Import/export round-trips a notebook document without losing cell IDs,
  language, source, outputs, or metadata.
- Cell 2 can read a variable defined in Cell 1 inside the same notebook
  session.
- Closing a notebook tab disposes its runtime session.
- Markdown cells render without allowing script execution.

### `RL-047` Slice A: explicit visualization API

Goal: make algorithm visualization reliable by emitting structured snapshots
from user code rather than guessing source structure.

Implementation boundaries:

- Build on `RichOutputPayload` and notebook session output, not a parallel
  store-only protocol.
- Start with arrays and sorting snapshots for JS/TS.
- Provide explicit calls such as `lingua.visualize.array(name, value, meta?)`
  and `lingua.visualize.step(label?)`.
- Cap snapshots and payload size.
- Keep AST auto-instrumentation for a later slice after parser-specific design.

Acceptance:

- A sorting example produces a bounded snapshot timeline with play, pause,
  step-forward, step-back, and speed controls.
- The currently displayed snapshot can highlight the source line that emitted
  it.
- Oversized or circular payloads produce a bounded diagnostic entry.
- No visualization capture runs unless the user code explicitly opts in.
