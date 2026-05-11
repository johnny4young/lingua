# ADR — Language-pack architecture (RL-038)

| Status | Accepted — current migration complete for built-in surfaces |
| ------ | ------------------------------------------------ |
| Decision | Introduce a declarative `LanguagePack` descriptor and migrate built-ins + Lua to consume it, without promoting plugin loading into a marketplace. |
| Date | 2026-04-19 |
| Next revisit | When a third non-JS language needs real LSP/debugger hooks (RL-026, RL-027) or when the built-in set grows past 8 and the switch statements bite. |

## Context

Lingua currently spreads language metadata across ~8 files:

- `src/renderer/utils/languageMeta.ts` — file extensions, default code,
  display labels.
- `src/renderer/utils/languageCapabilities.ts` — run / validate / view
  mode enumeration.
- `src/renderer/utils/language.ts` — extension-to-language resolver.
- `src/renderer/data/templates.ts` — starter templates per language.
- `src/renderer/runners/{javascript,typescript,go,python,rust}.ts` and
  `src/renderer/runners/manager.ts` — runtime dispatch.
- `src/renderer/monaco.ts` — Monaco registration / completion providers.
- `src/renderer/components/Toolbar/Toolbar.tsx` + language selector
  menus — hardcoded switch statements for display + iconography.
- `src/renderer/plugins/lua-runner/` — a separate plugin shape that
  does not share the built-in contract.

Adding a new language today requires touching 5–6 of these files in
parallel, and the Lua plugin cannot express capabilities (formatter,
LSP support flags, docs link) through a shared descriptor. RL-038 asks
us to consolidate the metadata into one descriptor so the app can
render capability-aware UI without scattered `switch(language)`
statements, while keeping third-party arbitrary-code loading out of
scope.

## Decision

Introduce a **`LanguagePack` descriptor type** in `src/shared/` and
migrate built-ins + Lua to consume it. The descriptor is the single
source of truth for:

| Field | Today's home | Owner after migration |
|-------|--------------|------------------------|
| `id` (stable string) | `Language` union in `src/renderer/types/index.ts` | `LanguagePack.id` |
| `label` | `languageMeta.ts` + ad-hoc copy | `LanguagePack.labelKey` (i18n key) |
| `icon` | Toolbar + selector hardcodes | `LanguagePack.icon` (lucide name or inline SVG id) |
| `extensions` | `languageMeta.ts` + `language.ts` | `LanguagePack.extensions[]` |
| `monacoLanguage` | `monacoLanguageFor` switch | `LanguagePack.monacoLanguage` |
| `defaultCode` | `languageMeta.ts` | `LanguagePack.defaultCode` or reference to a template id |
| `executionMode` | `languageCapabilities.ts` | `LanguagePack.execution` (`run` \| `compile` \| `validate` \| `view`) |
| `runnerId` | `runners/manager.ts` dispatch | `LanguagePack.runnerId` |
| `formatter` | `src/renderer/utils/formatters.ts` | `LanguagePack.formatter` (`prettier` \| `ipc:gofmt` \| `ipc:rustfmt` \| `ipc:python` \| `none`) |
| `lspSupport` | not modeled | `LanguagePack.capabilities.lsp` (`builtin` \| `adapter` \| `desktop` \| `none`) |
| `debuggerSupport` | not modeled | `LanguagePack.capabilities.debugger` (`none` \| `planned` \| `available`) |
| `docsUrl` | scattered | `LanguagePack.docsUrl` |
| `starterTemplateIds` | `data/templates.ts` | `LanguagePack.templateIds[]` |

### Shape

```ts
export interface LanguagePack {
  id: string;
  labelKey: string;
  icon: string;
  extensions: readonly string[];
  monacoLanguage: string;
  defaultCode?: string;
  execution: 'run' | 'compile' | 'validate' | 'view';
  runnerId: string | null;
  formatter: 'prettier' | 'ipc:gofmt' | 'ipc:rustfmt' | 'ipc:python' | 'none';
  capabilities: {
    lsp: 'builtin' | 'adapter' | 'desktop' | 'none';
    debugger: 'none' | 'planned' | 'available';
    runtimeDependencies?: readonly string[];
  };
  docsUrl?: string;
  templateIds: readonly string[];
}

export const LANGUAGE_PACKS: readonly LanguagePack[] = [
  // javascript, typescript, python, go, rust, lua, plus the validate-mode
  // file types (json, yaml, dotenv, toml, ini, csv, dockerfile, makefile,
  // editorconfig, gitignore, shellscript)
];
```

### Resolver helpers (replace the scattered switches)

```ts
getLanguagePackById(id: string): LanguagePack | undefined
getLanguagePackForExtension(ext: string): LanguagePack | undefined
runnerIdFor(lang: Language): string | null // from pack.runnerId
monacoLanguageFor(lang: Language): string   // from pack.monacoLanguage
executionModeFor(lang: Language): LanguagePack['execution']
formatterStrategyFor(lang: Language): LanguagePack['formatter']
```

These live in `src/renderer/utils/languagePacks.ts` and re-export the
existing helper names so callers don't have to migrate all at once.

## Migration plan (three slices)

This section is historical implementation context. All three slices are
now shipped for the built-in surfaces Lingua has today; revisit the
descriptor only when one of the triggers below is hit.

### Slice A — Land the descriptor + migrate built-ins that already have
all fields computed today. Shipped 2026-04-20.

- Create `src/shared/languagePacks.ts` with the `LanguagePack` type
  and an initial `LANGUAGE_PACKS` array populated from today's
  `languageMeta.ts` + `languageCapabilities.ts` + `runners/manager.ts`.
- Rewrite `languageMeta.ts` + `languageCapabilities.ts` + `language.ts`
  as thin shims on top of the pack array — behavior preserved, API
  preserved, but data moves to the pack.
- Target: zero behavior change. All existing tests stay green.
- Files touched: ~6. Scope: one session.

### Slice B — Migrate the runners dispatch. Shipped 2026-04-20.

- Replace the `switch` in `runners/manager.ts` with a lookup:
  `LANGUAGE_PACKS.find(p => p.id === lang)?.runnerId` then instantiate
  from a runnerId → runner factory map.
- Lua plugin exposes its own `LanguagePack` at registration time
  instead of a bespoke plugin shape. Built-in packs take precedence on
  id collision.
- Target: plugin authors register a `LanguagePack` object. No
  arbitrary-code loading is introduced.
- Files touched: ~4. Scope: one session.

### Slice C — Migrate capability-aware UI. Shipped 2026-05-01.

- Toolbar New File, FileTree rows, the Run-button desktop-only tooltip,
  `SnippetsModal`, and `EditorEmptyState` now read the shared pack array
  and the `languageCapabilityBadgeKey()` helper instead of local
  hardcoded language arrays.
- `SnippetsModal` surfaces every `run` / `compile` pack in registry
  order and appends a localized desktop-only suffix on web builds for
  host-toolchain packs.
- `EditorEmptyState` surfaces runnable packs that also ship starter
  templates; Lua intentionally stays out of the quick-start row until
  it gains a starter template, but it is available in the snippet
  picker.
- The original Settings capability-matrix note was speculative. Lingua
  has no per-language Settings surface today; if one is added later, it
  should consume `getLanguagePackById()` / `LANGUAGE_PACKS` from the
  start instead of opening a new switch statement.
- Capability-aware rendering for non-runnable packs still reads
  `pack.execution` at the surfaces that execute code.

## Constraints

- **No third-party code loading** is added. Plugins register
  `LanguagePack` descriptors at build time, same as built-ins. A
  future plugin marketplace is out of scope and must open its own
  ADR.
- **i18n parity is preserved**: `labelKey` replaces any inline display
  string, so every locale still carries one key per language.
- **CapabilityMatrix stays the source of truth** for execution-class
  decisions (browser WASM vs desktop native). The language pack only
  records *which* class a language uses via `pack.capabilities` —
  `CAPABILITY_MATRIX.md` says *whether* the class is recommended.

## Acceptance criteria (from RL-038 scope)

- **"Adding a new bundled language no longer requires scattered edits
  across the app"** — satisfied after slices A + B + C. A new pack still
  needs the pack entry plus its i18n key, and optional templates /
  runner wiring depending on execution mode.
- **"The app can render capability-aware UI per language without
  hardcoded switch statements everywhere"** — satisfied after slice
  C.
- **Constraint: "Do not market this as a finished extension
  marketplace"** — honored. This ADR and every downstream diff will
  call the mechanism a "language pack descriptor", not "plugin
  marketplace".

## When to revisit

Open a successor ADR when:

1. A third non-JS language needs real LSP support (RL-026 gains
   serious traction). The `lsp` capability field will need a richer
   shape than the enum.
2. The debugger MVP (RL-027) lands and `debuggerSupport` needs
   protocol details, not just a flag.
3. Language-pack count passes 12 and the bundled array becomes too
   heavy to ship in the main chunk. Lazy-load per-pack becomes
   relevant.
4. Plugin loading evolves from compile-time registration to
   runtime (unlikely before a dedicated ADR).

## Impact on adjacent items

- `CAPABILITY_MATRIX.md` (RL-030) — unchanged. The language pack does
  not move any capability between execution classes.
- `BUILD_SYSTEM_ADR.md` (RL-034) — unchanged.
- `TAURI_SPIKE_ADR.md` (RL-035) — unchanged.
- RL-042 ("Expand language support toward 15+ languages") can now
  proceed on the pack-based path: each new language is an entry, an
  i18n key, and a runner factory registration.
- RL-058 ("view/lint mode for common dev files") already lists its
  covered file types in `languageCapabilities.ts`; slice A folds them
  into the pack array.

## Reviewers

- First recorded decision: 2026-04-19.

Future revisits leave a dated entry rather than overwrite, so the
migration history stays auditable.
