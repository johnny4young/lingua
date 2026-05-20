# World-class lane — ticket quick-reference

> One-card-per-ticket browsing surface for the 14 new RL-XXX tickets +
> 4 extensions promoted from `WORLD_CLASS_PLAN.md` on 2026-05-20.
>
> **Source of truth:** `docs/PLAN.md` (deep scope, AC, dependencies) +
> `docs/ROADMAP.md` (status + sequence). This file is a convenience
> overview; PLAN/ROADMAP win on every conflict.

## Slot order (matches ROADMAP §5)

| Slot | Ticket | Priority | Status | Estimate |
|------|--------|:--------:|:------:|---------:|
| 9 | RL-027 Slice 1.5b (existing — security carve-out) | P1 | `Partial` | gated |
| 10 | RL-044 next slice + Sub-slice F | P1 | `Partial` | ~1-2 days |
| 11 | RL-024 Slice 1 (multi-file) | P1 | `Planned` | 3-4 days |
| 12 | RL-094 Slice 1 (Run Capsules) | P1 | `Planned` | 1-2 days |
| 13 | RL-095 (Language Scorecard) | P1 | `Planned` | 1 day |
| 14 | RL-036 Phase A1 (share — existing) | P1 | `Planned` | 1-2 days |
| 15 | RL-101 Slice 1 (Onboarding) | P1 | `Planned` | 1.5 days |
| 16 | RL-096 Slice 1 (Trust Dashboard) | P1 | `Planned` | 2 days |
| 17 | RL-025 Slice A (deps — existing) | P1 | `Planned` | 2-3 days |
| 18 | RL-102 Slice 1 (Git read-only) | P1 | `Planned` | 2 days |
| 19 | RL-103 Slice 1 (Project templates) | P2 | `Planned` | 2 days |
| 20 | RL-097 Slice 1 (HTTP) | P1 | `Planned` | 2-3 days |
| 21 | RL-099 Slice 1 (Pipelines) | P2 | `Planned` | 2 days |
| 22 | RL-031 Slice 0/1 (AI Ollama — existing) | P1 | `Planned` | 3-4 days |
| 23 | RL-098 Slice 1 (CLI) | P2 | `Planned` | 2 days |
| 24 | RL-100 Slice 1 (Importers cURL) | P2 | `Planned` | 1 day |
| 25 | RL-039 Slice B (Recipes) | P2 | `Partial` | 2-3 days |
| 26 | RL-043 Slice A (Notebook — existing) | P1 | `Planned` | 4-5 days |
| 27+ | RL-031 Slice 2, RL-107, RL-047, RL-050 Phase A, RL-104, RL-105, RL-106, RL-050 Phase B | P2-P3 | varies | — |
| 35 | RL-108 Slice 1 (Inline lint + quick-fixes) | P1 | `Planned` | 2-3 days |
| 36 | RL-111 Slice 1 (Workspace session restore) | P1 | `Planned` | 1.5 days |
| 37 | RL-109 Slice 1 (Project-scoped env isolation) | P1 | `Planned` | 2 days |
| 38 | RL-110 Slice 1 (Smart paste detection) | P2 | `Planned` | 1 day |
| 39 | RL-113 (Cmd+; Recent commands) | P2 | `Planned` | 0.5 day |
| 40 | RL-112 (Persistent status bar) | P2 | `Planned` | 1.5 days |
| 41 | RL-115 (Inline per-line timing) | P2 | `Planned` | 1 day |
| 42 | RL-116 (Focus / Presenter mode) | P3 | `Planned` | 0.5 day |
| 43 | RL-114 (Test runner auto-detect) | P2 | `Planned` | 2 days |
| 44 | RL-024 Slice 2 (Cross-project replace) | P2 | `Planned` | 1.5 days |
| 45 | RL-117 Phase A (Cloud sync ADR) | P3 | `Research-backed spike` | 1 day (ADR only) |

---

## Cards (alphabetical by RL-ID)

### RL-024 — Multi-file projects (extension, promoted)

**Slice 1**: sidebar tree + open folder + per-file dirty marker + Cmd+Shift+F find-in-files.
**Status**: `Planned` (already existed; promoted to slot 11).
**Deep scope**: PLAN.md `### RL-024` + extension under "World-class lane — Extensions".
**Sequence**: slot 11. Foundation — converts scratchpad into workspace.

### RL-031 — Slice 2: Local Docs + AI citations (extension)

**Slice 2**: token-scoring retrieval over local docs + AI request plan UI + cited responses.
**Pre-req**: RL-031 Slice 0/1 (Ollama bridge MVP) + RL-096 Slice 1 (Trust Dashboard).
**Status**: `Planned`.
**Deep scope**: PLAN.md `### RL-031` + extension under "World-class lane — Extensions".
**Sequence**: slot 27+.

### RL-039 — Slice B: Recipes (extension)

**Slice B**: Cmd+Shift+L fuzzy search → recipe cards with prompt + starter code + Run+Test assertions.
**Pre-req**: RL-094 Slice 1.
**Status**: `Partial` (Slice A shipped — guided tour).
**Deep scope**: PLAN.md `### RL-039` + extension under "World-class lane — Extensions".
**Sequence**: slot 25.

### RL-044 — Sub-slice F: Clickable error stacks (extension)

**Sub-slice F**: error payload gets optional `clickable: { file, line, column }`; console panel makes frames click-to-jump.
**Bundled into**: next RL-044 slice (rich-media payloads).
**Status**: `Partial` (Slice 1A/1B/1C shipped).
**Deep scope**: PLAN.md "World-class lane — Extensions" → RL-044 Sub-slice F.
**Sequence**: slot 10 (rides with the next RL-044 slice).

### RL-050 — Phase A spike + Phase B cross-internet (extension)

**Phase A spike**: `docs/LAN_COLLABORATION_ADR.md` — transport (WebRTC vs WebSocket) + threat model.
**Phase A implementation**: read-only LAN host/join with short code/QR (after ADR approval).
**Phase B**: cross-internet pair via Cloudflare TURN (gated on Phase A ship).
**Status**: `Future` (Phase A spike active).
**Deep scope**: PLAN.md `### RL-050` + extension under "World-class lane — Extensions".
**Sequence**: slot 27+ (Phase A spike) → much later (Phase B).

### RL-094 — Run Capsules

**Slice 1**: `RunCapsuleV1` schema + redaction registry + export of latest run.
**Status**: `Planned`. **Priority**: `P1`.
**Why**: spine artifact for share / CLI / AI / HTTP / pipelines / lessons / importers.
**Pre-req**: RL-044 next slice (stable RichOutputPayload).
**Deep scope**: PLAN.md `### RL-094`.
**Sequence**: slot 12.

### RL-095 — Language Support Scorecard

**Slice 1**: typed `LanguageSupportProfile` matrix across 9 axes + Settings scorecard panel + capability matrix docs guard test.
**Status**: `Planned`. **Priority**: `P1`.
**Why**: defensive lock — every future language flip has a typed home.
**Pre-req**: none (RL-038 already `Done`).
**Deep scope**: PLAN.md `### RL-095`.
**Sequence**: slot 13.

### RL-096 — Privacy + Trust Dashboard

**Slice 1**: new Settings tab with redaction preview + local stores audit + network activity summary + run-history timeline.
**Status**: `Planned`. **Priority**: `P1`.
**Why**: co-located trust surface BEFORE more network features land.
**Pre-req**: RL-094 Slice 1 (extracts `src/shared/redaction.ts`).
**Deep scope**: PLAN.md `### RL-096`.
**Sequence**: slot 16.

### RL-097 — HTTP + SQL Workspace

**Slice 1**: HTTP collections bottom-panel tab. Controlled `fetch` with redacted Authorization/Cookie headers. Responses are `RunCapsuleV1`.
**Slice 2**: DuckDB-WASM SQL scratchpad (deferred).
**Status**: `Planned`. **Priority**: `P1`.
**Pre-req**: RL-094 Slice 1, RL-044 next slice.
**Deep scope**: PLAN.md `### RL-097`.
**Sequence**: slot 20.

### RL-098 — CLI Companion

**Slice 1**: `lingua utility json-format` + `lingua capsule validate`. Pure shared/main; no renderer imports.
**Status**: `Planned`. **Priority**: `P2`.
**Pre-req**: RL-094 Slice 1.
**Deep scope**: PLAN.md `### RL-098`.
**Sequence**: slot 23.

### RL-099 — Utility Pipelines

**Slice 1**: pipeline engine + JSON pipeline. Lives inside existing `<UtilityToolbar>`.
**Status**: `Planned`. **Priority**: `P2`.
**Pre-req**: utility refactor (overlaps with RL-098 if it ships first).
**Deep scope**: PLAN.md `### RL-099`.
**Sequence**: slot 21.

### RL-100 — Importers

**Slice 1**: importer registry + cURL text → `HttpRequestV1` with preview-then-confirm modal.
**Slice 2**: `.ipynb` (deferred).
**Slice 3**: Bruno/Postman (deferred).
**Status**: `Planned`. **Priority**: `P2`.
**Pre-req**: RL-097 Slice 1 (HTTP workspace exists).
**Deep scope**: PLAN.md `### RL-100`.
**Sequence**: slot 24.

### RL-101 — Onboarding Choreography

**Slice 1**: pre-seeded scratchpad with real code + post-first-run toast + post-first-snippet toast. Once per stage. Settings reset.
**Status**: `Planned`. **Priority**: `P1`.
**Pre-req**: RL-023 (Snippet Lab), RL-039 (tour infrastructure).
**Deep scope**: PLAN.md `### RL-101`.
**Sequence**: slot 15.

### RL-102 — Git Read-Only Layer

**Slice 1**: desktop-only `git:detect` / `:status` / `:diff` IPC + tab status pill + Git Diff bottom-panel tab.
**Status**: `Planned`. **Priority**: `P1`.
**Why**: desktop devs expect Git awareness; read-only is the safe MVP.
**Pre-req**: RL-024 Slice 1 (project root).
**Deep scope**: PLAN.md `### RL-102`.
**Sequence**: slot 18.

### RL-103 — Project Templates

**Slice 1**: 5 curated `ProjectTemplateV1` JSONs (Express, FastAPI, Node CLI, React, Python data). Welcome panel + palette entry.
**Status**: `Planned`. **Priority**: `P2`.
**Pre-req**: RL-024 Slice 1, RL-025 Slice A.
**Deep scope**: PLAN.md `### RL-103`.
**Sequence**: slot 19.

### RL-104 — WebGPU AI Inference (web) — Spike

**Phase A**: ADR + 50-prompt quality test. Implementation gated until ADR approved.
**Slice A** (only if approved): constrained tasks (explain-regex, format-JSON-with-commentary). NO chat.
**Status**: `Research-backed spike`. **Priority**: `P3`.
**Pre-req**: RL-094, RL-096.
**Deep scope**: PLAN.md `### RL-104`.
**Sequence**: slot 27+.

### RL-105 — Mobile Companion (PWA, read-only)

**Slice 1**: separate repo `lingua-mobile`. PWA at `m.linguacode.dev`. Read-only Shiki-rendered share-link viewer. NO authoring (per `ANTI_FEATURES.md` §A-011).
**Status**: `Planned`. **Priority**: `P3`.
**Pre-req**: RL-094 Slice 1, RL-036 Phase A1.
**Deep scope**: PLAN.md `### RL-105`.
**Sequence**: slot 27+.

### RL-106 — Curated Community Snippets

**Slice 1**: 50 starter snippets bundled in-app. Fuzzy search. PR-only contribution path. No marketplace (per `ANTI_FEATURES.md` §A-004).
**Status**: `Planned`. **Priority**: `P3`.
**Pre-req**: RL-023 stable.
**Deep scope**: PLAN.md `### RL-106`.
**Sequence**: slot 27+.

### RL-107 — VSCode Theme Import

**Slice 1**: `themeImport.ts` parser. Settings → Appearance → "Import VSCode theme..." button. Tested on Dracula, Solarized Dark, One Dark Pro.
**Status**: `Planned`. **Priority**: `P3`.
**Pre-req**: RL-075 (Signal-Slate canonical tokens — already `Done`).
**Deep scope**: PLAN.md `### RL-107`.
**Sequence**: slot 27+.

---

## Tier 1 cards (RL-108 .. RL-111 — promoción 2026-05-20)

### RL-108 — Inline lint + quick-fixes (Monaco)

**Slice 1 (JS/TS only)**: Web Worker corre `typescript` + `esbuild-wasm` en modo análisis; diagnostics debounced a 500 ms y publicados via `setModelMarkers`. 5 quick-fixes deterministas vía Cmd+. (`add missing import`, `remove unused import`, `add semicolon`, `replace == with ===`, `wrap in try/catch`). Settings toggle per-language.
**Status**: `Planned`. **Priority**: `P1`.
**Why**: cierre del gap perceptual contra VSCode; lint en vivo es el gesto-firma de un editor moderno.
**Pre-req**: ninguna (usa `typescript` + `esbuild-wasm` ya bundled).
**Deep scope**: PLAN.md `### RL-108`.
**Sequence**: slot 35.

### RL-109 — Project-scoped environment isolation

**Slice 1**: `ProjectEnvScopeV1` schema + per-project env store + Settings → Environment → nueva pestaña "Project". Composición User → Workspace → Project; el último gana. Cleanup de scopes huérfanos > 90 días opt-in.
**Status**: `Planned`. **Priority**: `P1`.
**Why**: previene env-var bleed entre proyectos cuando RL-024 multi-file shippea (footgun de seguridad).
**Pre-req**: RL-024 Slice 1.
**Deep scope**: PLAN.md `### RL-109`.
**Sequence**: slot 37.

### RL-110 — Smart paste detection

**Slice 1**: clipboard handler registry con 5 detectores priorizados (share-link / capsule / cURL / stack-trace / large-JSON). Toast non-blocking ofrece intent correcto; Cmd+Shift+V escapa a paste literal. Setting toggle (default ON).
**Status**: `Planned`. **Priority**: `P2`.
**Why**: el contenido del clipboard ya carga semántica; ignorarlo es UX flat.
**Pre-req**: RL-036 Phase A1, RL-097 Slice 1, RL-100 Slice 1, RL-044 Sub-slice F.
**Deep scope**: PLAN.md `### RL-110`.
**Sequence**: slot 38.

### RL-111 — Workspace session restore

**Slice 1**: `SessionSnapshotV1` (tabs + bottom-panel layout + cursor + breakpoints + autoLog + stdin + variableInspector). `before-quit` captura; boot ofrece "Restaurar sesión" como toast (default `ask`). Settings `never`/`ask`/`always`. License tokens NUNCA exportados.
**Status**: `Planned`. **Priority**: `P1`.
**Why**: senior devs esperan "abrir Lingua donde lo dejé"; extiende el contrato RL-089.
**Pre-req**: ninguna (extiende RL-089 conceptualmente).
**Deep scope**: PLAN.md `### RL-111`.
**Sequence**: slot 36.

---

## Tier 2 cards (RL-112 .. RL-117 — promoción 2026-05-20)

### RL-112 — Persistent status bar

**Slice 1**: 24px fixed bottom bar con segmentos: language / lint counts / cursor pos / encoding / indent / git branch / run status. Click en cada segmento dispara acción. Toggle Settings → Editor (default ON desktop, OFF web).
**Status**: `Planned`. **Priority**: `P2`.
**Pre-req**: RL-108 (segment lint, degrada graceful), RL-102 (segment git, oculto sin él).
**Deep scope**: PLAN.md `### RL-112`.
**Sequence**: slot 40.

### RL-113 — Cmd+; Recent commands stack

**Slice 1**: ring buffer 20 comandos; Cmd+; popover con 8 más recientes + atajos 1-8. Per-sesión persist.
**Status**: `Planned`. **Priority**: `P2`.
**Pre-req**: ninguna.
**Deep scope**: PLAN.md `### RL-113`.
**Sequence**: slot 39.

### RL-114 — Test runner auto-detect

**Slice 1**: `detectTestRunner(projectRoot)` lee package.json/pyproject.toml/Cargo.toml/go.mod. Bottom-panel "Tests" tab + palette "Run project tests". Stream output con coloring PASS/FAIL.
**Status**: `Planned`. **Priority**: `P2`.
**Pre-req**: RL-024 Slice 1, RL-019 (Node subprocess pattern).
**Deep scope**: PLAN.md `### RL-114`.
**Sequence**: slot 43.

### RL-115 — Inline per-line timing

**Slice 1 (JS/TS only)**: `// @time` magic-comment + transform inyecta `__mc_time(line, durationMs)`. Monaco gutter decorations `▸ 320 ms`; línea más lenta resalta rojo. Setting toggle (default OFF).
**Status**: `Planned`. **Priority**: `P2`.
**Pre-req**: RL-020 Slice 5 (auto-log surface).
**Deep scope**: PLAN.md `### RL-115`.
**Sequence**: slot 41.

### RL-024 Slice 2 — Cross-project search + replace (extensión)

**Slice 2**: Cmd+Shift+H overlay con preview before/after por archivo, confirmación per-file, regex + case-sensitive toggles, excludes (`node_modules`, `.git`). Atomic via tmpfile rename. Undo funciona vía Monaco's edit API.
**Status**: `Planned`. **Priority**: `P2`.
**Pre-req**: RL-024 Slice 1.
**Deep scope**: PLAN.md "Tier 2 polish" → "RL-024 Slice 2 — Search + replace cross-project".
**Sequence**: slot 44.

### RL-116 — Focus / Presenter mode

**Slice 1**: Cmd+K F toggle. Activo oculta chrome + sube font editor +4 + console +2 + oculta status bar. CSS overlay opcional. Restaura layout al apagar.
**Status**: `Planned`. **Priority**: `P3`.
**Pre-req**: ninguna.
**Deep scope**: PLAN.md `### RL-116`.
**Sequence**: slot 42.

### RL-117 — Personal cloud sync via user-owned storage

**Phase A (ADR only)**: `docs/CLOUD_SYNC_ADR.md` responde provider (Dropbox / Drive / Gist), qué se sincroniza, threat model, conflict resolution, encryption at rest. Decisión explícita de extender o no `ANTI_FEATURES.md` §A-006 con reversal note.
**Phase B**: gated tras ADR approval + reversal note merged.
**Status**: `Research-backed spike`. **Priority**: `P3`.
**Pre-req**: RL-089 (`Done`).
**Deep scope**: PLAN.md `### RL-117`.
**Sequence**: slot 45.

---

## Tier 3 — Conscientemente fuera de scope (2026-05-20)

Seis items NO se planean. Razón documentada en PLAN.md "Tier 3" + reverse-allowed-if por item.

| ID | Item | Razón principal | Reverse-allowed-if |
|----|------|-----------------|---------------------|
| T3-001 | Plugin/extension API real | Anti-feature §A-014 (marketplace) | Partner enterprise con NDA + budget para sandbox + review |
| T3-002 | Cross-language refactoring | Cost/value mal balance (< 5% usuarios) | Caso concreto + diseño que evite el costo |
| T3-003 | Profiling / flame graphs | Chrome DevTools/py-spy ya existen gratis | n/a — RL-115 cubre 80% del use case casual |
| T3-004 | DB clients embedded | Scope creep severo (50+ features) | Decisión explícita de competir con TablePlus/DBeaver |
| T3-005 | Docker integration | RL-048 terminal sirve como escape hatch | n/a |
| T3-006 | Snippet auto-save versioning | Git-mal-reinventado (RL-102 + RL-089 + RL-111 cubren) | Caso de uso concreto |

---

## How `lingua-ship` discovers these tickets

The skill reads:

- **`ROADMAP.md` §4** — for the candidate pool (Status ∈ {Partial, Planned}). All 14 new RL-XXX rows live in §4k.
- **`ROADMAP.md` §5** — for the recommended sequence (tiebreaker). Slots 9-26 are the world-class lane.
- **`PLAN.md`** — for deep scope. Each `### RL-XXX` section is grep-discoverable.

When you run `/lingua-ship`, the agent's Phase 1 (planning) picks the next slot per §5 ordering. No additional configuration needed.

## How to run a slice

```bash
/lingua-ship
```

Phase 1 writes a single-ticket plan in chat. You reply:

- `approved` → execute as-is.
- `approved with: A, C` → fold only listed suggestions.
- `approved with: all` → fold everything.
- `change to RL-YYY` → restart Phase 1 with a different ticket.

Phase 2 implements, runs gates, stages, and prints the Review Guide. You commit when satisfied.

## Anti-features at a glance

Read `docs/ANTI_FEATURES.md` for the full catalogue. The 15 anti-features that bind all 14 new tickets:

| ID | Anti-feature | Lives in ticket where? |
|----|--------------|------------------------|
| A-001 | Mandatory account | every Pro-gated ticket |
| A-002 | Telemetry without opt-in | every new telemetry event |
| A-003 | Blockchain / crypto | n/a (refused outright) |
| A-004 | Social-network features | RL-106 (curated-only) |
| A-005 | Ads / sponsored content | every UI surface |
| A-006 | Mandatory cloud sync | RL-094 (local export), RL-107 (no sync) |
| A-007 | AI without citations | RL-031 Slice 2, RL-104 |
| A-008 | Background network calls | RL-096 surfaces them |
| A-009 | Hidden AI context | RL-031 Slice 2 (prompt preview) |
| A-010 | Cross-internet pair before LAN | RL-050 Phase B gated |
| A-011 | Mobile authoring | RL-105 (read-only only) |
| A-012 | Hosted-credit AI pool | RL-031, RL-104 |
| A-013 | Real-time multi-cursor | RL-050 (read-only only) |
| A-014 | Arbitrary-code plugin marketplace | RL-038 (bundled only) |
| A-015 | VSCode keybinding parity | RL-074 keymap presets |
