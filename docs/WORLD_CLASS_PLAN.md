# Lingua world-class differentiation plan

> Status: research-backed planning packet, not ROADMAP authority.
> Date: 2026-05-20
>
> This document turns the recent product research into self-contained
> candidate tickets. The executable planning source of truth remains
> `ROADMAP.md`, `SPRINT-PLAN.md`, `PLAN.md`, and `BACKLOG.md`.
>
> Candidate IDs in this file use the `WC-XXX` prefix on purpose. They are not
> `RL-XXX` tickets until one is formally promoted into `ROADMAP.md` and
> `PLAN.md`.

## Product thesis

Lingua should not try to beat every specialized tool at its own narrow job.
The stronger position is a local-first developer workspace where small pieces
of code, utility outputs, HTTP requests, SQL queries, lessons, and AI-assisted
actions all share the same execution, history, privacy, and sharing model.

The differentiator is not "more panels." It is repeatable workflows:

- run code and tools in one place;
- capture the exact input, environment summary, output, and diagnostics;
- replay or share that work without leaking secrets;
- keep language support modular so Ruby, Python, TypeScript, Go, Rust, and
  future languages evolve independently;
- make AI helpful only when it can cite the local context it used and preserve
  the user's control.

## Planning relationship

Do not interrupt the current roadmap sequence for this packet unless a human
explicitly promotes one candidate. The current roadmap should still lead with:

1. `RL-027` Slice 1.5b: conditional breakpoints and watch expressions.
2. `RL-044`: rich output renderer migration.
3. `RL-036`: no-backend single-tab share links.
4. `RL-025`: explicit dependency management.
5. `RL-031`: desktop-local Ollama bridge.
6. `RL-043`: notebook schema and runner-owned sessions.
7. `RL-047`: explicit visualization payload API.

The `WC-XXX` tickets below either refine those existing lanes or describe
candidate new lanes that should graduate one at a time.

## Non-negotiable design rules

- Keep language integrations adapter-based. A Ruby implementation change must
  not touch TypeScript, Python, Go, or Rust behavior except through a shared
  interface with tests.
- Use existing contracts first: `RichOutputPayload`, execution history,
  language packs, `window.lingua.*`, utility stores, and the capability matrix.
- No silent package installs, background network calls, or secret-bearing
  exports.
- Keep web and desktop capability differences explicit. Web can be powerful,
  but desktop owns local toolchains, local files, native subprocesses, and
  keychain-backed secrets.
- Every promoted ticket needs at least one real runtime smoke when it touches
  user-facing UI.

## Competitive anchors

These are source inspirations, not feature checklists to copy:

- Replit Agent: project-level assisted workflows and deployment context.
- Cursor: editor-native AI with context and explicit user actions.
- WebContainers: browser-hosted Node project execution.
- marimo / Observable: reactive notebooks and durable outputs.
- Bruno / Postman: request collections and repeatable API workflows.
- DevToys: fast local utilities.

Lingua's advantage should be the combination: local-first, polyglot,
privacy-aware, and workflow-replayable.

## Recommended world-class sequence

1. Finish `RL-044` and `RL-036` so outputs and share links have stable
   contracts.
2. Promote `WC-001` Run Capsules. This becomes the backbone for replay,
   imports, challenge packs, CLI, and support reports.
3. Promote `WC-002` Tool Pipelines v2 so utilities become workflows, not
   isolated panels.
4. Promote `WC-003` HTTP + SQL Workspace after rich output can render tables,
   JSON trees, and response bodies well.
5. Promote `WC-006` CLI Companion once Run Capsules can be replayed outside
   the GUI.
6. Promote `WC-004` Executable Lessons and Challenge Packs once capsules and
   notebooks are stable.
7. Promote `WC-005` Local Docs + AI after `RL-031` proves the local AI bridge.
8. Promote `WC-007` Importers, then `WC-008` Trust Dashboard, then `WC-009`
   Language Support Scorecard.
9. Keep `WC-010` LAN collaboration parked until local share, capsules, and
   trust reporting are mature.

## Candidate Tickets

### WC-001 Run Capsules

**Goal:** Create a portable, replayable record of one run: source, language,
runtime mode, stdin, safe environment summary, dependency summary, outputs,
rich payloads, duration, diagnostics, and redaction metadata.

**Why this matters:** Run Capsules make Lingua more than a scratchpad. They
unlock support reports, deterministic reruns, share previews, CLI replay,
challenge packs, notebook export, and bug reproduction.

**Existing anchors:** `RL-028` execution history, `RL-036` share links,
`RL-044` rich outputs, `RL-025` dependency summaries, `RL-020` variable
inspector snapshots.

**Scope:**

- Add a versioned `RunCapsuleV1` schema under `src/shared/`.
- Capture manual runs first; auto-run capture is opt-in later.
- Include line results, console output, rich output payload references, scope
  snapshot summary, runtime status, duration, timeout, and runner diagnostics.
- Include safe environment metadata only: language, runtime mode, workflow
  mode, app version, platform bucket, and dependency lock summary when present.
- Add export and import helpers that validate version, size, language, and
  privacy flags before opening anything.
- Add a compact "Save capsule" action near run history and a read-only capsule
  preview before import.

**Out of scope:**

- Cloud storage.
- Real-time collaboration.
- Full filesystem snapshots.
- Secret export, absolute paths, private env values, license tokens, or
  keychain references.

**Suggested implementation areas:**

- `src/shared/runCapsule.ts`
- `src/renderer/stores/executionHistoryStore.ts`
- `src/renderer/runtime/executeTabManually.ts`
- `src/renderer/components/RunCapsules/`
- `tests/shared/runCapsule.test.ts`
- `tests/components/RunCapsules/`

**Acceptance criteria:**

- A successful JS or TS manual run exports a capsule and imports into a new
  tab with the same code, language, stdin, runtime mode, and output preview.
- A failed run exports status, stderr, diagnostics, and duration without
  crashing import.
- Oversized, unsupported-version, unknown-language, and tampered capsules are
  rejected with localized notices.
- Redaction tests prove license tokens, absolute user paths, and env values do
  not appear in serialized capsules.
- Existing execution history remains usable when capsule export is disabled.

**Validation:**

- Unit tests for schema round-trip, redaction, version rejection, and size
  limits.
- Component test for preview/import states.
- Web smoke for export/import of one JS/TS run.
- Desktop smoke only if native runtime metadata is included in the first
  promoted slice.

### WC-002 Tool Pipelines v2

**Goal:** Let users chain utility panels into repeatable workflows such as
Base64 decode -> JSON format -> diff, JWT decode -> JSON tree -> copy field,
or URL parse -> query table -> CSV export.

**Why this matters:** Lingua already has many utilities. Pipelines turn the
catalog into a workflow system and create a clear differentiator over one-off
utility apps.

**Existing anchors:** `RL-069` DevUtils productivity layer,
`utilityOutputStore`, `utilityHistoryStore`, favorites, smart-detect Apply,
and command palette actions.

**Scope:**

- Add a `UtilityPipeline` schema with ordered steps, panel IDs, input mapping,
  output mapping, and display names.
- Add "Send output to..." from every compatible utility output.
- Add a small pipeline runner that executes client-side utility functions only.
- Add saved pipelines in local storage with import/export.
- Start with deterministic text utilities only: Base64, JSON, YAML, CSV, URL,
  Regex, Hash text mode, and Diff.
- Add a pipeline result view that records each step's input summary, output
  summary, error, and duration.

**Out of scope:**

- Background automation.
- File watchers.
- Network requests.
- Native subprocesses.
- AI-generated pipelines in the first slice.

**Suggested implementation areas:**

- `src/renderer/utils/developerUtilities.ts`
- `src/renderer/stores/utilityPipelineStore.ts`
- `src/renderer/components/DeveloperUtilities/UtilityPipelinePanel.tsx`
- `src/renderer/components/DeveloperUtilities/UtilityToolbar.tsx`
- `tests/renderer/utils/utilityPipeline.test.ts`

**Acceptance criteria:**

- A user can build and save a two-step JSON pipeline from utility outputs.
- Re-running a saved pipeline with new input updates all downstream steps.
- If one step fails, downstream steps stop and show the exact failing step.
- Pipeline import rejects unknown utility IDs and unsupported versions.
- Existing utility panels keep working without knowing about pipelines.

**Validation:**

- Unit tests for pipeline execution, versioning, compatibility, and failure
  handling.
- Component test for create, save, rerun, and delete.
- Web smoke for one pipeline using Spanish and English UI labels if strings
  change.

### WC-003 HTTP + SQL Workspace

**Goal:** Add first-class HTTP request collections and SQL scratchpads that
share Lingua's history, rich output, redaction, and future capsule model.

**Why this matters:** API requests and data queries are daily developer
workflows. Combining them with code snippets, utilities, and local-first
privacy makes Lingua a stronger everyday workspace.

**Existing anchors:** `RL-044` rich table/JSON rendering, `RL-025`
dependency isolation, `BACKLOG.md` HTTP and SQL raw ideas, utility history,
and environment-variable ADRs.

**Scope:**

- Add an HTTP collection schema with requests, headers, body, auth mode,
  safe env references, and response history.
- Add a SQL document schema with connection kind, query text, result preview,
  and history.
- Web SQL starts with DuckDB-WASM over pasted/imported CSV/JSON data.
- Desktop SQL can later add SQLite/Postgres bridges behind explicit user
  approval.
- HTTP requests run through a controlled client that redacts Authorization,
  Cookie, API keys, and configured sensitive headers in history/export.
- Render responses through rich output: status, headers, body text, JSON tree,
  table preview, and timing.

**Out of scope:**

- OAuth production flows.
- Secret vault sync.
- Cloud request collections.
- Mutating database explorers.
- Raw database credentials in share links or capsules.

**Suggested implementation areas:**

- `src/shared/httpWorkspace.ts`
- `src/shared/sqlWorkspace.ts`
- `src/renderer/components/HttpWorkspace/`
- `src/renderer/components/SqlWorkspace/`
- `src/renderer/stores/workspaceToolStore.ts`
- `src/renderer/utils/redaction.ts`

**Acceptance criteria:**

- A user can create, run, save, and rerun a GET request with headers and see
  status, duration, headers, and body.
- Sensitive headers are redacted in history, export, capsules, and support
  reports.
- A user can paste CSV/JSON into a DuckDB-backed SQL scratchpad and query it
  in the web build.
- SQL query results render as a rich table with text fallback.
- Desktop-only database connection affordances are hidden or disabled in web
  with clear copy.

**Validation:**

- Unit tests for collection schemas and redaction.
- Integration tests for local mocked HTTP responses.
- Web smoke for one HTTP request and one DuckDB query.
- Desktop smoke when native database bridges are promoted.

### WC-004 Executable Lessons and Challenge Packs

**Goal:** Package lessons, prompts, starter code, expected outputs, assertions,
and solution explanations as local-first challenge packs.

**Why this matters:** Lingua can serve learners and interview prep without
becoming a generic course platform. The differentiator is runnable,
inspectable, replayable practice across languages.

**Existing anchors:** `RL-023` Snippet Lab, `RL-039` guided lessons,
`RL-043` notebooks, `RL-047` visualization, and future Run Capsules.

**Scope:**

- Add a `LessonPackV1` schema with metadata, language options, starter code,
  tests/assertions, hints, and solution notes.
- Add an in-app lesson browser that can open a lesson into a normal editor tab
  or notebook tab.
- Add assertion runners for JS/TS first; Python follows once the contract is
  stable.
- Save local progress: opened, attempted, passed, skipped, and last run.
- Allow packs to reference Run Capsules as examples once `WC-001` ships.

**Out of scope:**

- User accounts.
- Cloud leaderboards.
- Paid course marketplace.
- AI grading in the first slice.

**Suggested implementation areas:**

- `src/shared/lessonPack.ts`
- `src/renderer/components/Lessons/`
- `src/renderer/stores/lessonProgressStore.ts`
- `docs/lessons/`
- `tests/shared/lessonPack.test.ts`

**Acceptance criteria:**

- A bundled lesson pack appears in the lesson browser.
- Opening a lesson creates a tab with starter code and instructions.
- Running assertions produces pass/fail details without replacing normal
  console output.
- Progress persists across reload.
- Invalid pack schemas are rejected with a developer-facing diagnostic.

**Validation:**

- Unit tests for pack parsing and assertion result normalization.
- Component tests for browser/open/progress states.
- Web smoke for completing one JS/TS lesson.

### WC-005 Local Docs + AI With Citations

**Goal:** Make local documentation and local AI cooperate: answer questions
about language APIs, utility behavior, and current code using cited local
sources, not opaque chat.

**Why this matters:** AI is valuable when users can trust where the answer came
from. This fits Lingua's local-first positioning better than generic hosted
chat.

**Existing anchors:** `RL-031` local AI bridge, `AI_BRIDGE_ADR.md`, language
packs, `docs/USAGE.md`, and utility metadata.

**Scope:**

- Add a local docs registry with source name, version, license note, and
  indexed pages.
- Start with app docs, utility help metadata, and curated language snippets.
- Add retrieval that returns source IDs and excerpts to the AI bridge.
- AI responses must show citations and insertion/copy actions separately.
- Keep prompt preview and context list visible before sending.

**Out of scope:**

- Automatic web crawling.
- Hidden project-wide indexing.
- Hosted credit pool.
- BYO cloud keys.
- Sending unrelated tabs by default.

**Suggested implementation areas:**

- `src/shared/localDocs.ts`
- `src/main/ai/`
- `src/renderer/components/AiPanel/`
- `src/renderer/stores/aiStore.ts`
- `tests/main/ai/`

**Acceptance criteria:**

- Desktop can answer one local-docs question through Ollama with visible
  citations.
- Web mode explains that local AI is unavailable unless a future web provider
  is configured.
- The prompt preview lists every source included.
- The user must explicitly copy, insert, or apply generated code.
- Missing model, offline model, and cancelled stream states have clear UI.

**Validation:**

- Unit tests for retrieval ranking and source attribution.
- Main-process tests for prompt construction and cancellation.
- Desktop smoke for one local docs question if the runner environment has
  Ollama; otherwise a mocked bridge smoke.

### WC-006 CLI Companion

**Goal:** Provide a small `lingua` CLI for running snippets, replaying Run
Capsules, validating lesson packs, and using deterministic utilities in CI.

**Why this matters:** A CLI makes Lingua useful outside the GUI and turns the
product into a bridge between local experimentation and repeatable automation.

**Existing anchors:** Run Capsules, utility functions, language runner
contracts, and package/dependency adapters.

**Scope:**

- Add commands:
  - `lingua run <file>` for supported local languages.
  - `lingua capsule replay <capsule-file>`.
  - `lingua utility <tool-id>` for deterministic text utilities.
  - `lingua lesson validate <pack-file>`.
- Reuse shared schema and utility modules where possible.
- Output JSON with `--json` and human-readable text by default.
- Keep desktop GUI and CLI state separate unless the user passes explicit
  paths.

**Out of scope:**

- Full project management.
- GUI automation.
- Cloud sync.
- Native packaging changes in the first spike.

**Suggested implementation areas:**

- `src/cli/`
- `src/shared/runCapsule.ts`
- `src/shared/lessonPack.ts`
- `src/renderer/utils/` modules promoted to shared where appropriate
- `tests/cli/`

**Acceptance criteria:**

- `lingua utility json-format` can format stdin and emit JSON output metadata.
- `lingua capsule replay` validates and replays one capsule without opening
  the GUI.
- Exit codes distinguish success, user input error, runtime error, and
  unsupported capability.
- CLI code does not import React or renderer-only modules.

**Validation:**

- CLI unit tests for argument parsing, exit codes, and JSON output.
- Replay fixture tests using a checked-in safe capsule fixture.
- CI smoke on macOS and Linux once the CLI packaging shape is chosen.

### WC-007 Importers

**Goal:** Import common developer artifacts into Lingua workflows: notebooks,
Postman/Bruno collections, cURL snippets, code sandboxes, and plain snippet
folders.

**Why this matters:** Importers lower the switching cost and let users bring
existing work into Lingua without rebuilding it manually.

**Existing anchors:** `RL-036` share/import paths, `RL-043` notebooks,
`WC-003` HTTP workspace, existing cURL converter, and future Run Capsules.

**Scope:**

- Add an importer registry with `detect`, `preview`, and `import` phases.
- Start with `.ipynb`, Bruno collections, Postman collections, and cURL text.
- Preview import changes before creating tabs or collections.
- Normalize imported artifacts to Lingua schemas, not one-off component state.
- Add importer diagnostics for unsupported versions and lossy fields.

**Out of scope:**

- Cloud imports.
- Browser extension import.
- Private credential migration.
- Perfect fidelity for every source format.

**Suggested implementation areas:**

- `src/shared/importers/`
- `src/renderer/components/ImportPreview/`
- `src/renderer/stores/importStore.ts`
- `tests/shared/importers/`

**Acceptance criteria:**

- Importing a minimal `.ipynb` creates a notebook document with markdown and
  code cells.
- Importing a cURL command creates an HTTP request draft.
- Importing a Bruno/Postman collection previews requests and redacts secrets.
- Unsupported source versions show a diagnostic and do not partially mutate
  app state.

**Validation:**

- Fixture-based importer tests.
- Component test for preview and confirm/cancel flows.
- Web smoke for cURL-to-request import.

### WC-008 Privacy and Trust Dashboard

**Goal:** Give users one place to see what Lingua stores, what it sends, what
it redacts, and which features are local, desktop-only, or networked.

**Why this matters:** Local-first is only valuable if users can verify it. This
also reduces support load when AI, sharing, HTTP, licensing, and telemetry all
coexist.

**Existing anchors:** telemetry consent, recovery export, license/update
network calls, `RL-036` share links, `RL-031` AI, and security docs.

**Scope:**

- Add a Settings surface that lists local stores, cache locations, and clear
  actions.
- Add a network activity summary grouped by feature: updates, license,
  telemetry, AI, HTTP workspace, share/export.
- Add share/capsule redaction preview before export.
- Add AI context preview before send.
- Add a trust event log with bounded local retention.

**Out of scope:**

- Full packet capture.
- Blocking every network call at the OS level.
- Enterprise policy management.

**Suggested implementation areas:**

- `src/renderer/components/Settings/PrivacyTrustSection.tsx`
- `src/renderer/stores/trustEventStore.ts`
- `src/shared/redaction.ts`
- `src/main/telemetry/`
- `docs/USAGE.md`

**Acceptance criteria:**

- Users can see whether telemetry, AI, and sharing are enabled.
- Export previews show exactly which fields will be omitted or redacted.
- Clearing a local store updates the dashboard without reload.
- Trust events cap storage and never include secret values.
- English and Spanish copy stays neutral and actionable.

**Validation:**

- Unit tests for trust event redaction and retention.
- Component tests for dashboard state.
- Web smoke for clear/export preview paths.

### WC-009 Language Support Scorecard

**Goal:** Show and test a clear capability matrix per language: syntax
highlighting, autocomplete, LSP, run mode, desktop native mode, package
support, stdin, rich output, debugger, and capsules.

**Why this matters:** Recent Ruby issues showed that "language support" must
be decomposed. A scorecard makes gaps visible and prevents one language's
implementation from regressing another.

**Existing anchors:** `RL-038` language-pack registry, `RL-042` language
expansion, `RL-026` LSP, capability matrix, and language runtime adapters.

**Scope:**

- Add a shared `LanguageSupportCapability` enum.
- Derive the scorecard from language packs and runner/LSP registration, not
  hardcoded UI copy.
- Add an internal Settings or developer diagnostics panel listing each
  language and capability status.
- Add tests that every declared language has explicit capability values.
- Add a docs table generated or checked from the same source.

**Out of scope:**

- Shipping new language runtimes.
- Promising "complete" support for any language without syntax, run, and
  intelligence tests.
- Marketplace plugin language support.

**Suggested implementation areas:**

- `src/shared/languageSupport.ts`
- `src/renderer/languages/`
- `src/renderer/components/Settings/LanguageIntelligenceSection.tsx`
- `docs/CAPABILITY_MATRIX.md`
- `tests/shared/languageSupport.test.ts`

**Acceptance criteria:**

- Ruby, TypeScript, JavaScript, Python, Go, and Rust each show explicit
  support states.
- Adding or editing a language requires updating one typed capability object.
- Tests fail if a language has ambiguous capability fields.
- Docs and UI use the same labels for support states.

**Validation:**

- Unit tests for capability derivation.
- Docs guard test for capability table drift.
- Component test for scorecard rendering in light and dark themes.

### WC-010 LAN Collaboration and Pairing

**Goal:** Add local-network pairing for temporary shared sessions without
central cloud collaboration.

**Why this matters:** This fits Lingua's privacy story better than immediate
cloud realtime and helps classrooms, interviews, and pair debugging.

**Existing anchors:** `RL-036` sharing, `RL-050` real-time collaboration,
Run Capsules, and trust dashboard.

**Scope:**

- Add explicit host/join pairing with a short code or QR.
- Start read-only: follower receives code, current output, and run status.
- Add clear network indicator and disconnect controls.
- Limit to LAN or direct peer channels; no always-on cloud presence.
- Require an explicit share preview before a session starts.

**Out of scope:**

- Multi-user editing.
- Cloud relay as default.
- User accounts.
- Persistent shared workspaces.

**Suggested implementation areas:**

- `src/main/collaboration/`
- `src/renderer/components/Collaboration/`
- `src/renderer/stores/collaborationStore.ts`
- `src/shared/collaboration.ts`
- `docs/CAPABILITY_MATRIX.md`

**Acceptance criteria:**

- Host can start a read-only local session and stop it.
- Joiner can connect with an explicit code and see code/output updates.
- Secret-bearing fields are excluded by default.
- Network status and disconnect states are visible.
- The feature is unavailable with clear copy when the platform cannot support
  it.

**Validation:**

- Unit tests for session schema and redaction.
- Main-process tests for pairing lifecycle.
- Manual two-client smoke before declaring the first promoted slice done.

## Implementation addendum

This section is intentionally more concrete than the product brief above. Use
it as the starting point when promoting a candidate into `PLAN.md`.

### Readiness split

| Candidate | Implementation readiness | Promotion guidance |
|---|---|---|
| `WC-001` Run Capsules | Ready after promotion | Promote as one `RL-XXX` with 3 slices: schema/redaction, export, import preview. |
| `WC-002` Tool Pipelines v2 | Ready after promotion | Promote as one `RL-XXX` with pure utility adapters first; no AI or background jobs. |
| `WC-003` HTTP + SQL Workspace | Split before promotion | Promote HTTP collections and DuckDB SQL as separate slices or separate tickets. |
| `WC-004` Lessons and Challenge Packs | Split before promotion | Promote pack schema/browser first; JS/TS assertions second; progress third. |
| `WC-005` Local Docs + AI | Spike first unless `RL-031` is already shipped | Requires local AI bridge contract and mocked Ollama test harness. |
| `WC-006` CLI Companion | Split before promotion | Start with deterministic utilities and capsule validation before code execution. |
| `WC-007` Importers | Split before promotion | Promote registry + cURL importer first, then `.ipynb`, then Bruno/Postman. |
| `WC-008` Privacy and Trust Dashboard | Split before promotion | Start with local stores + redaction preview; network activity and AI context later. |
| `WC-009` Language Support Scorecard | Ready after promotion | Promote early; it reduces language-regression risk before more runtime work. |
| `WC-010` LAN Collaboration | Spike first | Needs transport and threat-model decision before implementation scope is safe. |

### Shared implementation rules

- Every persisted artifact must have a `version` literal, a parser, a
  serializer, and a migration policy. Do not persist anonymous object shapes.
- Shared schemas live in `src/shared/*` and are covered by unit tests before
  UI work starts.
- Renderer components should call typed actions or adapters; they should not
  own parsing, redaction, or execution logic.
- Redaction must be centralized. Any ticket that exports, shares, logs, or
  records history must reuse the same sensitive-key and sensitive-value rules.
- Web-only and desktop-only behavior must be represented as explicit capability
  states, not hidden `try/catch` fallbacks.
- New telemetry must use closed enums and must never include code, request
  bodies, SQL text, AI prompts, headers, env values, or file paths.
- For each promoted ticket, write fixtures before UI: valid fixture, invalid
  version fixture, oversized fixture, and secret-bearing fixture when export or
  history is involved.

### WC-001 implementation detail: Run Capsules

**First implementable slice:** shared schema + redaction + export from the
latest manual run. Do not implement import in the first commit unless the
schema tests are already green.

**Suggested contract:**

```ts
type RunCapsuleV1 = {
  version: 1;
  capsuleId: string;
  createdAt: string;
  appVersion: string;
  tab: {
    name: string;
    language: string;
    runtimeMode: string;
    workflowMode: string;
  };
  source: {
    content: string;
    contentHash: string;
  };
  input: {
    stdin?: string;
  };
  result: {
    status: 'success' | 'error' | 'timeout' | 'stopped';
    durationMs: number;
    stdout?: string;
    stderr?: string;
    lineResults?: unknown[];
    richOutputs?: unknown[];
    diagnostics?: unknown[];
  };
  environment: {
    platform: 'web' | 'desktop';
    runner: string;
    dependencySummary?: unknown;
  };
  privacy: {
    redactionVersion: string;
    omittedFields: string[];
  };
};
```

**Core functions:**

- `buildRunCapsule(input): RunCapsuleV1`
- `sanitizeRunCapsule(input): RunCapsuleV1`
- `parseRunCapsule(value: unknown): ParseRunCapsuleResult`
- `summarizeRunCapsule(capsule): RunCapsulePreview`
- `hydrateTabFromRunCapsule(capsule): Partial<FileTab>`

**State flow:**

1. `executeTabManually` receives an `ExecutionResult`.
2. Capsule builder reads only the active tab, result, and safe settings.
3. Export action serializes validated JSON.
4. Import action parses JSON, renders a preview, then creates a new tab only
   after user confirmation.

**Edge cases to lock:**

- Capsule created on desktop Node imported in web: tab opens, execution is not
  auto-started, and the UI says the original runtime is unavailable.
- Capsule with rich HTML payload: preview uses the same sandbox rules as
  `RL-044`; scripts do not execute.
- Capsule with a huge table: import keeps metadata and truncated preview,
  never blocks the renderer.
- Capsule with secret-looking headers, env keys, or local paths: parser keeps
  the capsule valid but redacts or omits those fields.
- Capsule from a future version: reject with "unsupported version", not
  "corrupt file".

**Minimum tests:**

- `tests/shared/runCapsule.test.ts`: schema round-trip, future version,
  malformed JSON, size cap, redaction.
- Component test: export button disabled with no run, enabled after a run,
  preview on import, confirm creates a tab.
- Web smoke: run a JS snippet, export, import, verify code and output preview.

### WC-002 implementation detail: Tool Pipelines v2

**First implementable slice:** pipeline schema + pure execution engine + JSON
format pipeline. Do not wire every utility panel in the first slice.

**Suggested contract:**

```ts
type UtilityPipelineV1 = {
  version: 1;
  id: string;
  name: string;
  steps: UtilityPipelineStepV1[];
};

type UtilityPipelineStepV1 = {
  id: string;
  utilityId: string;
  input:
    | { source: 'initial' }
    | { source: 'stepOutput'; stepId: string; path?: string };
  options?: Record<string, unknown>;
};
```

**Adapter rule:** pipeline execution must depend on pure utility adapters, not
React panels. A utility becomes pipeline-compatible only when it exposes:

- `id`
- `inputKind`
- `outputKind`
- `run(input, options): UtilityPipelineStepResult`
- `describeInput(input): string`
- `describeOutput(output): string`

**Initial compatible utilities:**

- JSON format/minify.
- YAML to JSON / JSON to YAML.
- Base64 text encode/decode.
- URL parse/build.
- Regex replace.
- Diff text.

**Edge cases to lock:**

- A pipeline references a removed utility ID.
- Step B references a missing Step A.
- A utility returns binary output; first slice should reject it as
  unsupported.
- Output exceeds the per-step cap; downstream steps receive the truncated
  value only if the adapter marks truncation as safe.
- A generator utility such as Random String is selected; first slice should
  mark it incompatible.

**Minimum tests:**

- Pure engine tests for success, step failure, incompatible output, removed
  utility, import/export.
- Component test for create -> run -> save -> rerun.
- Web smoke for Base64 decode -> JSON format -> copy result.

### WC-003 implementation detail: HTTP + SQL Workspace

**Promotion shape:** avoid one giant ticket. Use two implementation slices at
minimum:

1. `WC-003A` HTTP collections.
2. `WC-003B` DuckDB SQL scratchpad.

**HTTP first-slice contract:**

```ts
type HttpRequestV1 = {
  version: 1;
  id: string;
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  url: string;
  headers: Array<{ name: string; value: string; enabled: boolean }>;
  body?: { kind: 'text' | 'json'; value: string };
  auth?: { kind: 'none' | 'bearer' | 'basic'; valueRef?: string };
};
```

**HTTP implementation notes:**

- Start with same-origin-safe web `fetch` and clear CORS errors. Desktop
  proxying can be a later slice.
- Store secrets as env references, not raw values, when the feature grows auth
  helpers.
- Response history stores redacted headers and body preview, not the full
  unbounded response.
- Binary responses should show metadata and a download/copy-disabled state in
  the first slice.

**SQL first-slice contract:**

```ts
type SqlScratchpadV1 = {
  version: 1;
  id: string;
  name: string;
  engine: 'duckdb-wasm';
  sources: Array<{ id: string; name: string; kind: 'csv' | 'json' }>;
  query: string;
};
```

**SQL implementation notes:**

- Treat DuckDB-WASM as a capability with explicit loading, error, and
  unavailable states.
- Cap imported datasets before they reach the worker.
- Run queries with timeout and row caps.
- Render results through `RichOutputPayload` table output; do not invent a
  second table renderer.

**Edge cases to lock:**

- Invalid URL, blocked CORS, timeout, 4xx, 5xx, binary body, huge JSON body.
- Sensitive headers in request and response.
- Malformed CSV, large CSV, SQL syntax error, long-running query, empty result.

**Minimum tests:**

- HTTP schema and redaction unit tests.
- Mocked fetch integration tests for success, CORS-like failure, timeout, and
  sensitive headers.
- DuckDB adapter tests with tiny CSV/JSON fixtures.
- Web smoke for one GET and one SQL query.

### WC-004 implementation detail: Lessons and Challenge Packs

**Promotion shape:** implement pack schema and browser before assertions.

**Suggested contract:**

```ts
type LessonPackV1 = {
  version: 1;
  id: string;
  title: string;
  lessons: LessonV1[];
};

type LessonV1 = {
  id: string;
  title: string;
  language: string;
  promptMarkdown: string;
  starterCode: string;
  assertions: LessonAssertionV1[];
  hints?: string[];
};

type LessonAssertionV1 =
  | { kind: 'stdoutIncludes'; value: string }
  | { kind: 'exitStatus'; value: 'success' | 'error' }
  | { kind: 'expressionEquals'; expression: string; expectedJson: unknown };
```

**Implementation notes:**

- First assertion slice should support JS/TS only.
- Assertions run after normal execution and must not replace console output.
- Lesson progress should store only lesson ID, status, last attempt timestamp,
  and last result summary.
- Pack Markdown must render through the same sanitized Markdown path used
  elsewhere.

**Edge cases to lock:**

- Lesson references a language that is unavailable.
- Assertion throws while user code succeeds.
- User code times out.
- Pack contains duplicate lesson IDs.
- Pack contains unsafe Markdown or oversized starter code.

**Minimum tests:**

- Parser tests for valid pack, duplicate IDs, unsupported version, oversized
  prompt, unsafe Markdown.
- Assertion runner tests for pass/fail/error/timeout.
- Web smoke for open lesson -> run starter -> fail -> edit -> pass.

### WC-005 implementation detail: Local Docs + AI

**Promotion blocker:** do not implement this until the `RL-031` bridge owns
availability, model selection, streaming, cancellation, and error
normalization.

**Suggested contracts:**

```ts
type LocalDocSourceV1 = {
  id: string;
  title: string;
  version: string;
  licenseNote: string;
  pages: LocalDocPageV1[];
};

type RetrievedContextV1 = {
  sourceId: string;
  pageId: string;
  title: string;
  excerpt: string;
  score: number;
};

type AiRequestPlanV1 = {
  task: 'explain-code' | 'generate-code' | 'answer-doc-question';
  model: string;
  promptPreview: string;
  contexts: RetrievedContextV1[];
};
```

**Implementation notes:**

- Retrieval can start with simple token scoring; vector search is not required
  for the first slice.
- The renderer must show the request plan before sending.
- The AI response model should separate `answerMarkdown`, `citations`, and
  `actions`.
- Generated code should never auto-insert.
- If no context is retrieved, the UI should say that the answer will be based
  only on the selected code/prompt.

**Edge cases to lock:**

- Ollama missing, model missing, stream interrupted, user cancels, response has
  no citations, source was removed between retrieval and send.
- Prompt includes secrets; prompt preview must allow user cancellation before
  any request.

**Minimum tests:**

- Retrieval scoring fixtures.
- Prompt-plan construction tests.
- Mocked bridge tests for stream, cancel, error, and missing model.
- Component test for prompt preview and explicit apply/copy actions.

### WC-006 implementation detail: CLI Companion

**Promotion shape:** start with CLI infrastructure plus deterministic
utilities. Defer `lingua run` until module boundaries are clean enough to use
runner adapters without importing Electron or React.

**Suggested command contract:**

```txt
lingua utility <tool-id> [--input <file>] [--json]
lingua capsule validate <file> [--json]
lingua capsule replay <file> [--json]
lingua lesson validate <file> [--json]
```

**Exit codes:**

- `0`: success.
- `1`: user input or validation error.
- `2`: runtime execution error.
- `3`: unsupported capability.
- `4`: internal error.

**Implementation notes:**

- CLI modules live under `src/cli/` and import only `src/shared/*` or
  explicitly shared utility modules.
- Any utility needed by the CLI should be moved out of renderer-only paths
  before CLI import.
- `--json` output should be stable and snapshot-tested.
- Human output should stay concise and should never include secret-bearing
  values that schema validation redacted.

**Edge cases to lock:**

- Unknown command, unknown utility ID, invalid JSON input, broken capsule,
  unsupported runtime, stdout pipe closed.

**Minimum tests:**

- CLI parser unit tests.
- Spawn-level tests for exit codes and `--json` shape.
- Fixture tests for one utility and capsule validation.

### WC-007 implementation detail: Importers

**First implementable slice:** importer registry + cURL text importer. It is
small, uses existing cURL parsing work, and proves the preview flow before
larger formats.

**Suggested contract:**

```ts
type ImporterAdapter<TPreview, TResult> = {
  id: string;
  label: string;
  detect(input: ImportInput): ImportDetection;
  preview(input: ImportInput): ImportPreview<TPreview>;
  import(input: ImportInput, options: ImportOptions): ImportResult<TResult>;
};
```

**Implementation notes:**

- Import always has two phases: preview and confirm.
- Preview must list lossy fields before mutation.
- Import results should create normal Lingua documents or tool records, not
  importer-specific state.
- Unsupported versions should be diagnostics, not thrown exceptions.

**Importer order:**

1. cURL text -> HTTP request draft.
2. `.ipynb` -> `.linguanb` notebook document.
3. Bruno collection -> HTTP collection.
4. Postman collection -> HTTP collection.

**Edge cases to lock:**

- File extension lies about content.
- Input contains credentials.
- Source format version is newer than supported.
- Import partially succeeds; first slice should avoid partial mutation and
  require all-or-nothing.

**Minimum tests:**

- Registry detection order tests.
- Fixture tests for one valid and one invalid input per importer.
- Component test for preview, lossy warnings, confirm, and cancel.

### WC-008 implementation detail: Privacy and Trust Dashboard

**Promotion shape:** start with visible local state and redaction preview.
Network activity and AI context preview should be later slices.

**Suggested contract:**

```ts
type TrustEventV1 = {
  version: 1;
  id: string;
  at: string;
  feature:
    | 'license'
    | 'updates'
    | 'telemetry'
    | 'sharing'
    | 'ai'
    | 'http'
    | 'capsules';
  action: string;
  sensitivity: 'none' | 'redacted' | 'omitted';
  summary: string;
};
```

**Implementation notes:**

- Trust events are summaries, not logs. They must not include payload bodies,
  code, request headers, prompts, or file paths.
- The dashboard should read from existing stores first. Do not introduce a
  second settings source.
- Clear actions should reuse existing recovery/reset actions where possible.
- Export preview should call the same redaction functions as export itself.

**Edge cases to lock:**

- Trust event store exceeds cap.
- Redaction preview and actual export disagree.
- Telemetry disabled.
- License/update network calls exist but telemetry is off.
- User clears a store while a modal preview is open.

**Minimum tests:**

- Trust event retention and redaction unit tests.
- Component tests for local-store rows and clear actions.
- Web smoke for export preview and one clear action.

### WC-009 implementation detail: Language Support Scorecard

**First implementable slice:** typed support matrix + tests + internal
diagnostics panel. This is intentionally lower risk than adding another
language runtime.

**Suggested contract:**

```ts
type LanguageCapabilityStatus =
  | 'available'
  | 'partial'
  | 'desktop-only'
  | 'web-only'
  | 'planned'
  | 'unsupported';

type LanguageSupportProfile = {
  languageId: string;
  syntax: LanguageCapabilityStatus;
  autocomplete: LanguageCapabilityStatus;
  lsp: LanguageCapabilityStatus;
  webRuntime: LanguageCapabilityStatus;
  desktopRuntime: LanguageCapabilityStatus;
  packages: LanguageCapabilityStatus;
  stdin: LanguageCapabilityStatus;
  richOutput: LanguageCapabilityStatus;
  debugger: LanguageCapabilityStatus;
};
```

**Implementation notes:**

- The scorecard should be derived from language-pack declarations plus runner
  and LSP registries.
- A language cannot be added without an explicit `LanguageSupportProfile`.
- UI labels and docs labels should come from the same status enum.
- The panel can start as a developer diagnostics panel before becoming a
  public Settings surface.

**Edge cases to lock:**

- Ruby has runtime but no LSP.
- A language has syntax highlighting but validate-only execution.
- Desktop runtime exists but web runtime is unsupported.
- A profile references a language not in the language registry.

**Minimum tests:**

- Unit test: every language pack has a support profile.
- Unit test: every profile references a real language.
- Docs guard: capability matrix mentions each language.
- Component test: dark and light scorecard contrast.

### WC-010 implementation detail: LAN Collaboration

**Promotion blocker:** run a transport spike first. Decide whether the first
slice uses WebRTC data channels, a desktop-owned local WebSocket server, or a
hybrid. Do not start UI until the transport decision and threat model exist.

**First safe slice after spike:** read-only host/join with explicit preview.
No collaborative editing.

**Suggested contract:**

```ts
type LocalPairingSessionV1 = {
  version: 1;
  sessionId: string;
  role: 'host' | 'guest';
  mode: 'read-only';
  expiresAt: string;
  sharedFields: Array<'source' | 'stdout' | 'stderr' | 'richOutputs'>;
};
```

**Threat-model questions to answer before implementation:**

- Can a guest join without being on the same trusted network?
- Is traffic encrypted end-to-end or only local-network scoped?
- How does the host revoke a session immediately?
- What exact fields are shared by default?
- Does desktop need macOS local network permission copy or entitlement work?

**Edge cases to lock:**

- Pairing code expires.
- Guest disconnects.
- Host stops sharing.
- Network drops mid-run.
- Shared tab contains secrets that redaction should omit.

**Minimum tests after spike:**

- Transport lifecycle unit tests or main-process tests.
- Redaction tests for shared payload.
- Manual two-client smoke with screenshots before marking the first slice
  shipped.

## Promotion checklist

Before any `WC-XXX` ticket becomes implementation work:

1. Decide whether it maps to an existing `RL-XXX` or needs a new formal
   `RL-NNN`.
2. Add the authoritative scope to `docs/PLAN.md`.
3. Add the status row to `docs/ROADMAP.md`.
4. Add tactical execution detail to `docs/SPRINT-PLAN.md` only when it is
   picked for the current sprint.
5. Remove or shrink the corresponding `BACKLOG.md` bullet.
6. Add the UI/runtime validation path before coding starts.

## First promotion recommendation

Promote `WC-001` after `RL-044` and `RL-036` stabilize. Run Capsules create
the reusable artifact model that makes the later tickets cheaper and less
ambiguous. Without capsules, HTTP/SQL, lessons, CLI, importers, and AI context
all risk inventing incompatible export/replay formats.
