# World-class → RL-XXX promotion (overview)

> Status: PROMOTED on 2026-05-20. Deep ticket scope now lives in
> `docs/PLAN.md` (new sections RL-094..RL-107) and `docs/ROADMAP.md`
> (new §4k subsection). This doc keeps the rationale + mapping +
> sequence rationale + UX patterns for future reference.
>
> Inputs: `docs/WORLD_CLASS_PLAN.md` (WC-001..WC-010 candidate tickets)
> plus a second-pass review that added 7 more tickets and promoted 5
> that were originally deferred.
>
> Outputs (already landed in this commit):
> - **14 new `RL-094`..`RL-107` rows** in `ROADMAP.md` §4k + deep
>   sections in `PLAN.md`.
> - **4 extensions** to existing rows (`RL-024`, `RL-031`, `RL-039`,
>   `RL-050`) and **1 sub-slice extension** to `RL-044`.
> - **New `docs/ANTI_FEATURES.md`** — 15 anti-features locking the
>   product-positioning rejections.
> - **Updated `ROADMAP.md` §5** with the 26-slot sequence.
> - **Updated `BACKLOG.md`** — promoted bullet removed.
>
> Companion doc: `docs/WORLD_CLASS_TICKETS.md` — one-card-per-ticket
> quick reference for browsing without scrolling PLAN.md.

## 1. Why this proposal exists

`WORLD_CLASS_PLAN.md` produced ten self-contained candidate tickets
(`WC-001`..`WC-010`). Direct promotion to implementation required:

1. **RL-XXX IDs** — Lingua's planning convention requires `RL-XXX` IDs
   in `ROADMAP.md` / `PLAN.md`. `WC-XXX` was a holding pen.
2. **Reordered sequence** — Trust Dashboard at slot 8 (original) would
   accumulate privacy debt for seven slices. Local-first positioning
   needs the dashboard alongside features, not after them.
3. **Tighter slice boundaries** — `WC-003` (HTTP + SQL) and `WC-004`
   (Lessons) needed explicit "slice 1" cuts.
4. **Coherence contract** — Run Capsules is the spine, but the WC docs
   didn't explicitly state that share links, CLI replay, AI context,
   HTTP replay, lesson grading, and pipeline state all serialize as
   capsules.

A second-pass review then added 7 more tickets (multi-file promotion,
onboarding choreography, run-history timeline, clickable error stacks,
anti-features doc, git read-only, project templates) and promoted 5
previously-deferred ones (WebGPU AI spike, mobile PWA, curated
community snippets, cross-internet pair, VSCode theme import).

## 2. Promotion map (final)

| Source | RL | Title | Status seed |
|--------|----|-------|-------------|
| WC-001 | **RL-094** | Run Capsules | `Planned` |
| WC-009 | **RL-095** | Language Support Scorecard | `Planned` |
| WC-008 | **RL-096** | Privacy + Trust Dashboard | `Planned` |
| WC-003 | **RL-097** | HTTP + SQL Workspace | `Planned` |
| WC-006 | **RL-098** | CLI Companion | `Planned` |
| WC-002 | **RL-099** | Utility Pipelines | `Planned` |
| WC-007 | **RL-100** | Importers | `Planned` |
| Second-pass #1 | extend **RL-024** | Multi-file projects (promoted) | `Planned` (top priority) |
| Second-pass #2 | **RL-101** | Onboarding Choreography | `Planned` |
| Second-pass #3 | sub-section of **RL-096** | Run history timeline | included in RL-096 Slice 1 |
| Second-pass #4 | sub-slice of **RL-044** | Clickable error stack frames | included as Sub-slice F |
| Second-pass #5 | new doc | `docs/ANTI_FEATURES.md` | shipped |
| Second-pass #6 | **RL-102** | Git read-only layer | `Planned` |
| Second-pass #7 | **RL-103** | Project templates | `Planned` |
| WC-005 | extend **RL-031** | Local Docs + AI citations | `Planned` (Slice 2) |
| WC-004 | extend **RL-039** | Recipes (Lesson Packs) | `Partial` (Slice B) |
| WC-010 | extend **RL-050** | LAN Collaboration | `Future` (Phase A spike + B) |
| Previously deferred #8 | **RL-104** | WebGPU AI inference (web) | `Research-backed spike` |
| Previously deferred #9 | **RL-105** | Mobile companion PWA (read-only) | `Planned` |
| Previously deferred #10 | **RL-106** | Curated community snippets | `Planned` |
| Previously deferred #11 | extend **RL-050 Phase B** | Cross-internet pairing | `Future` |
| Previously deferred #12 | **RL-107** | VSCode theme import | `Planned` |

## 3. Execution sequence (26 slots — see ROADMAP §5 for the authoritative list)

The world-class lane occupies slots 9-26 of ROADMAP §5. Three tiers:

### Tier 1 — Foundation (slots 9-14)

1. **Slot 9 — RL-027 Slice 1.5b** — debugger watch + conditional bp (security carve-out gate; either land it or formally re-defer).
2. **Slot 10 — RL-044 next slice** — rich media (chart / image / sandboxed HTML) + Sub-slice F clickable error stacks. Stabilises the payload contract RL-094 capsules embed.
3. **Slot 11 — RL-024 Slice 1** — multi-file projects (sidebar tree + open folder + find-in-files). Promoted to top-priority — converts scratchpad into workspace.
4. **Slot 12 — RL-094 Slice 1** — Run Capsules schema + export. Spine artifact for everything downstream.
5. **Slot 13 — RL-095** — Language Support Scorecard. Cheap defensive lock.
6. **Slot 14 — RL-036 Phase A1** — no-backend share links. First consumer of capsule format.

### Tier 2 — Trust + growth (slots 15-20)

7. **Slot 15 — RL-101** — Onboarding Choreography. Aha moment in < 90s.
8. **Slot 16 — RL-096 Slice 1** — Trust Dashboard. Co-located trust BEFORE more network features.
9. **Slot 17 — RL-025 Slice A/B** — dependency management (existing ticket).
10. **Slot 18 — RL-102** — Git read-only layer.
11. **Slot 19 — RL-103** — Project templates.
12. **Slot 20 — RL-097 Slice 1** — HTTP workspace.

### Tier 3 — Compositional + AI (slots 21-26)

13. **Slot 21 — RL-099** — Utility Pipelines.
14. **Slot 22 — RL-031 Slice 0/1** — local Ollama AI.
15. **Slot 23 — RL-098** — CLI Companion.
16. **Slot 24 — RL-100** — Importers (cURL Slice 1).
17. **Slot 25 — RL-039 Slice B** — Recipes.
18. **Slot 26 — RL-043 Slice A** — Notebook foundation.

### Polish + research (slots 27+)

`RL-031` Slice 2 → `RL-107` → `RL-047` → `RL-050` Phase A spike → `RL-104` → `RL-105` → `RL-106` → `RL-050` Phase B.

## 4. Strong opinions baked into this sequence

These are the design choices that differ from a literal WORLD_CLASS_PLAN.md reading. Each is documented per-ticket in PLAN.md.

**A. Trust Dashboard at slot 16 (was originally slot 8 in WC plan).** Adding HTTP/AI/CLI/Importers without a Trust surface visible alongside them forces users to take Lingua's privacy claims on faith. The dashboard is cheap and pays compounding dividends.

**B. Language Scorecard at slot 13 (was slot 9 in WC plan).** Ruby (RL-042 Slice 5+6) showed that "language support" is multi-axis. Locking the typed matrix early prevents every future language slice from inventing its own status fields.

**C. Importers at slot 24 (was slot 7 in WC plan).** No sense importing to destinations that don't exist. cURL → HTTP needs HTTP workspace shipped first.

**D. Multi-file (RL-024) promoted to slot 11 (was Planned, blocked-by).** Without multi-file, Lingua is a scratchpad. With it (sidebar tree + open folder + find-in-files), it's a workspace. This is the single most leveraged sequencing change in this proposal.

**E. Run Capsule is the universal wire format.** Share links, CLI replay, AI prompts, HTTP responses, pipeline steps, lesson assertions all serialize through `RunCapsuleV1`. One fixture file feeds the tests of every downstream ticket.

**F. Redaction centralized.** `src/shared/redaction.ts` (extracted in RL-094 Slice 1) owns the sensitive-key + sensitive-value rules. Every export/share/log/AI prompt calls the same function. A contract test detects drift.

**G. Recipes, not Lessons.** WC-004 framed "lessons" as a course tree. Senior devs don't browse lessons — they look up recipes. RL-039 Slice B reframes accordingly.

**H. HTTP + SQL live in the BOTTOM PANEL.** Not a new top-level workspace. Keeps the editor-on-top + output-below mental model intact.

**I. Pipelines live in `<UtilityToolbar>`.** Not a new top-level section. "Utilities is the shelf; pipelines are saved compositions."

**J. CLI ships as `.cjs` first.** ESM-only Node compat is still a foot-gun in 2026.

**K. LAN Collab needs ADR before code.** RL-050 Phase A is a spike, not implementation.

**L. Debugger scorecard honest.** RL-095 marks JS/TS debugger as `partial` (conditional bp + watch expressions still gated).

**M. Anti-features are a positioning artifact.** `docs/ANTI_FEATURES.md` codifies 15 things Lingua refuses to be. Reversal requires explicit ADR.

## 5. UX patterns shared across all new tickets

Each new ticket follows these non-negotiable rules. Reviewers flag deviations.

1. **Empty state with one CTA + one link.** Every new surface has a curated empty state. No "No items found" minimalism.
2. **Command Palette first, button second.** Every new action ships with a palette entry. Buttons are for affordance; the palette is for muscle-memory.
3. **Settings co-location.** Each new feature gets a Settings section with master toggle + redaction preview + clear-all action. RL-096 Trust Dashboard surfaces ALL of them in one place.
4. **Pro gating visible BEFORE click.** Lock badge on entry point, not on destination. Mirrors the existing FloatingActionPill PRO chip.
5. **Status notice toast on every artifact create/import.** Reuse `pushStatusNotice`. 1-line summary + View/Undo/Open action. No silent success.
6. **Bottom panel adoption.** HTTP, pipelines run-preview, AI conversation live as bottom-panel tabs. No new top-level workspaces.
7. **Spanish tuteo, always.** `Pega` not `Pegá`, `Ejecuta` not `Ejecutá`.
8. **Telemetry closed enum.** Every new event has a matching closed-enum Set on both renderer + update-server, with source-parity test. No string-keyed payloads.

## 6. Coherence checks across tickets

These cross-cutting decisions stay consistent across slices. Tested in CI.

### 6a. Run Capsule is the universal wire format

Every artifact that crosses a boundary (export, share, CLI, AI prompt, lesson assertion, HTTP response, pipeline step) serializes through `RunCapsuleV1`. **Coherence test**: `tests/shared/runCapsule.fixtures.ts` provides 10 representative shapes that every downstream ticket's tests pull from.

### 6b. Redaction is centralized

`src/shared/redaction.ts` (extracted in RL-094 Slice 1) owns the sensitive-key and sensitive-value rules. **Coherence test**: `redaction.contract.test.ts` walks every registered caller and asserts the omitted-field set matches.

### 6c. Trust events have a stable shape

`TrustEventV1` (RL-096) is a SUMMARY type with `feature`, `action`, `sensitivity`, `summary: string`. No `payload?: unknown`. Trust event store rejects writes that don't conform.

### 6d. Settings tab order is contract

After RL-096 lands: General / Appearance / Editor / Environment / **Trust** (new) / Account / Shortcuts / Plugins / Recovery. Tests pin this order.

### 6e. Anti-features are documented and enforced

`docs/ANTI_FEATURES.md` lists 15 anti-features (A-001 through A-015). Reversal requires explicit ADR + commit in the same change.

## 7. What to ship next (recommendation)

After the currently-staged Slices 5+6 of RL-042 (Ruby web + desktop):

1. **RL-027 Slice 1.5b** OR formal re-defer (security carve-out).
2. **RL-044 next slice** — rich media + clickable stacks.
3. **RL-024 Slice 1** — multi-file projects (promoted to foundation).
4. **RL-094 Slice 1** — Run Capsules.
5. **RL-095** — Language Scorecard.
6. **RL-036 Phase A1** — share links.

Those 6 consecutive slots are the foundation. The remaining 20 ride on top.

## 8. Discoverability for lingua-ship

The skill picks tickets by reading:

- `ROADMAP.md` §4 — status table (rows must have `Status ∈ {Partial, Planned}`).
- `ROADMAP.md` §5 — recommended sequence (tiebreaker when multiple Partial/Planned qualify).
- `PLAN.md` — deep scope (grep `### RL-XXX` for the section).

All 14 new RL-XXX rows are now in `ROADMAP.md` §4k + `PLAN.md` deep sections + `ROADMAP.md` §5 slot mentions. `lingua-ship` will pick them in the §5 order.

## 9. Reference index

- **Deep ticket scope:** `docs/PLAN.md` — search `### RL-094` through `### RL-107`, plus extensions inside `### RL-024`, `### RL-031`, `### RL-039`, `### RL-044`, `### RL-050`.
- **Status board:** `docs/ROADMAP.md` §4k (active rows) + §5 (sequence).
- **Anti-features:** `docs/ANTI_FEATURES.md` — 15 product-positioning rejections.
- **Quick-reference cards:** `docs/WORLD_CLASS_TICKETS.md` — one card per ticket for browsing.
- **Original research:** `docs/WORLD_CLASS_PLAN.md` — WC-XXX candidate tickets (still kept; bullets retained for historical reference).
- **Prior synthesis:** `docs/WORK_PROPOSAL.md` — the v2.0 research synthesis that mapped older proposals onto existing RL-XXX.

## Appendix A — Schema sketches

These are the wire-format types that bind the tickets together. They land in `src/shared/` and are versioned with explicit `version: 1` literals.

### A.1 `RunCapsuleV1` (RL-094)

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

### A.2 `LanguageSupportProfile` (RL-095)

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

### A.3 `TrustEventV1` (RL-096)

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
    | 'capsules'
    | 'pipelines';
  action: string;
  sensitivity: 'none' | 'redacted' | 'omitted';
  summary: string; // string only; no payload, no body, no headers
};
```

### A.4 `HttpRequestV1` (RL-097)

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

### A.5 `UtilityPipelineV1` (RL-099)

```ts
type UtilityPipelineV1 = {
  version: 1;
  id: string;
  name: string;
  steps: Array<{
    id: string;
    utilityId: string;
    input:
      | { source: 'initial' }
      | { source: 'stepOutput'; stepId: string; path?: string };
    options?: Record<string, unknown>;
  }>;
};
```

### A.6 `LessonPackV1` (RL-039 Slice B)

```ts
type LessonPackV1 = {
  version: 1;
  id: string;
  title: string;
  lessons: Array<{
    id: string;
    title: string;
    language: string;
    promptMarkdown: string;
    starterCode: string;
    assertions: Array<
      | { kind: 'stdoutIncludes'; value: string }
      | { kind: 'exitStatus'; value: 'success' | 'error' }
      | { kind: 'expressionEquals'; expression: string; expectedJson: unknown }
    >;
    hints?: string[];
  }>;
};
```

### A.7 `ProjectTemplateV1` (RL-103)

```ts
type ProjectTemplateV1 = {
  version: 1;
  id: string;
  title: string;
  language: string;
  description: string;
  files: Array<{ relPath: string; content: string }>;
  dependencies?: DependencyManifest;
  runCommand?: string;
};
```

### A.8 `LocalPairingSessionV1` (RL-050 Phase A)

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
