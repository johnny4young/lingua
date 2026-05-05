# Renderer Reference

This is a **reference + explanation** page for Lingua's renderer. Use it as the fastest way to answer:

- where a UI feature should live
- which store or hook owns a behavior
- where to change shared styling
- what to update together when renderer behavior changes

For the project/file-system lifecycle and Electron IPC bridge, see [ARCHITECTURE.md](../../docs/ARCHITECTURE.md).

## Entry points

| File                                                                           | Responsibility                                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [main.tsx](main.tsx)   | React bootstrap, i18n/theme startup, app mount                   |
| [App.tsx](App.tsx)     | Top-level shell orchestration and modal wiring                   |
| [index.css](index.css) | Global design tokens, shell primitives, shared component classes |
| [monaco.ts](monaco.ts) | Monaco language registration, workers, completion bootstrap      |

## Folder map

| Path                                                                                | What belongs there                                                        |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`components/`](components) | User-visible UI grouped by feature surface                                |
| [`stores/`](stores)         | Zustand stores and pure helpers that own renderer state                   |
| [`hooks/`](hooks)           | React hooks that coordinate stores, runners, shortcuts, and shell effects |
| [`runners/`](runners)       | Language-specific execution adapters and result shaping                   |
| [`validation/`](validation) | Validate-only document checks for non-runnable development files          |
| [`workers/`](workers)       | Web Worker entry points for JS/TS/Python/Go browser execution             |
| [`utils/`](utils)           | Framework-agnostic helpers and renderer-specific utilities                |
| [`data/`](data)             | Static templates and catalog data                                         |
| [`i18n/`](i18n)             | Translation bootstrap and locale files                                    |
| [`themes/`](themes)         | Monaco/editor theme definitions                                           |
| [`plugins/`](plugins)       | Renderer-side plugin catalog, diagnostics, and safe runtime hooks         |

## Component surfaces

The renderer is intentionally split by feature instead of by component type.

| Feature folder                                                                                                    | Main files                                            | Notes                                                          |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| [`components/Layout/`](components/Layout)                 | `AppLayout.tsx`                                       | Owns shell composition, panel layout, sidebar/drawer behavior  |
| [`components/Editor/`](components/Editor)                 | `CodeEditor.tsx`, `EditorTabs.tsx`, `ResultPanel.tsx` | Owns Monaco, tabs, inline result surface, completion providers |
| [`components/FileTree/`](components/FileTree)             | `FileTree.tsx`, `FileTreeNode.tsx`                    | Owns project explorer rendering and inline tree interactions   |
| [`components/Toolbar/`](components/Toolbar)               | `Toolbar.tsx`                                         | Owns primary shell actions and status affordances              |
| [`components/Settings/`](components/Settings)             | `SettingsModal.tsx` plus section files                | Split by settings domain instead of one monolith               |
| [`components/CommandPalette/`](components/CommandPalette) | `CommandPalette.tsx`, `commandPaletteModel.ts`        | UI plus command catalog/model logic                            |
| [`components/Console/`](components/Console)               | `ConsolePanel.tsx`                                    | Runtime logs, filters, output actions                          |
| [`components/QuickOpen/`](components/QuickOpen)           | `QuickOpen.tsx`                                       | Project file search and open flows                             |
| [`components/Snippets/`](components/Snippets)             | `SnippetsModal.tsx`                                   | Snippet browser and insert flow                                |
| [`components/ui/`](components/ui)                         | `chrome.tsx`, `keyboard.ts`                           | Shared presentational primitives only                          |

## State ownership

Use the closest store that already owns the product concept instead of adding cross-cutting state to `App.tsx`.

| Store                                                                                               | Owns                                                              |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [editorStore.ts](stores/editorStore.ts)     | tabs, active editor session, file/language metadata               |
| [resultStore.ts](stores/resultStore.ts)     | inline results, validation markers, result timing, reveal behavior |
| [consoleStore.ts](stores/consoleStore.ts)   | console entries and runtime output filters                        |
| [projectStore.ts](stores/projectStore.ts)   | active project lifecycle and explorer tree state                  |
| [settingsStore.ts](stores/settingsStore.ts) | persisted renderer preferences                                    |
| [uiStore.ts](stores/uiStore.ts)             | transient shell visibility and modal state                        |
| [updateStore.ts](stores/updateStore.ts)     | updater status, messages, last-check timing                       |
| [pluginStore.ts](stores/pluginStore.ts)     | local plugin discovery and diagnostics surface                    |

## Naming conventions

Use the existing file names as the rule instead of introducing alternate patterns.

| Kind                             | Convention                           | Examples                                                          |
| -------------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| React components                 | `PascalCase.tsx`                     | `AppLayout.tsx`, `SettingsModal.tsx`, `ConsolePanel.tsx`          |
| Hooks                            | `useX.ts`                            | `useRunner.ts`, `useAutoRun.ts`, `useProjectWatchSync.ts`         |
| Zustand stores                   | `xStore.ts`                          | `editorStore.ts`, `resultStore.ts`, `updateStore.ts`              |
| Pure store helpers               | feature helper file beside the store | `projectTree.ts` beside `projectStore.ts`                         |
| Renderer utilities               | domain-oriented lowercase file       | `executionPresentation.ts`, `languageMeta.ts`, `magicComments.ts` |
| Shared presentational primitives | short semantic names                 | `chrome.tsx`, `keyboard.ts`                                       |

Prefer direct imports over renderer-wide barrel files. The only current barrel-style files are narrow local entry points such as feature `index.ts` files, not app-wide aggregation layers.

## Extraction guide

When a change grows, extract by ownership, not by line count alone.

| If the code mainly...                                             | Put it in...                                  | Why                                       |
| ----------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------- |
| renders user-visible UI for one product surface                   | the owning feature folder under `components/` | keeps feature work local                  |
| coordinates React lifecycle, subscriptions, shortcuts, or autorun | `hooks/`                                      | keeps orchestration out of JSX and stores |
| persists or shares renderer state across surfaces                 | the nearest Zustand store in `stores/`        | preserves a single source of truth        |
| transforms data without React or Zustand concerns                 | `utils/` or a pure helper beside the store    | improves testability and reuse            |
| defines static catalogs or templates                              | `data/`                                       | separates content from orchestration      |
| bootstraps Monaco/editor-wide integration                         | `monaco.ts` or `components/Editor/*`          | keeps editor setup discoverable           |

### When to create a new store

Create a new store only if the state:

- is shared across multiple feature surfaces
- must survive local component remounts
- has its own lifecycle distinct from existing stores

Do not create a store when local component state or a derived selector from an existing store is enough.

### When to create a new hook

Create a hook when the logic:

- combines more than one store or external subscription
- needs cleanup or lifecycle wiring
- would make a component read like orchestration instead of UI

Do not create a hook for one or two trivial lines that are only used once.

### When to extract a pure helper

Extract a helper when the logic:

- can be tested without React
- has branching/formatting behavior that obscures the main flow
- is likely to be reused by more than one store, runner, or component

Examples already in the codebase:

- [`projectTree.ts`](stores/projectTree.ts) for file-tree shaping
- [`executionPresentation.ts`](utils/executionPresentation.ts) for output formatting
- [`runnerOutput.ts`](hooks/runnerOutput.ts) for console/loading messages

## Styling rules

### Where to put styles

| Need                                              | Preferred location                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| Global tokens, shell classes, repeated primitives | [index.css](index.css) |
| One-off component layout/detail styling           | inline Tailwind classes in the owning component                                |
| Shared visual primitives                          | `components/ui` plus a matching class in `index.css` if reused widely          |

### How `index.css` is organized

`index.css` is intentionally split into four sections:

1. Theme tokens
2. Tailwind theme bridge
3. Base resets and browser/Electron globals
4. Reusable component classes

If you add a new global class, place it in the closest subsection instead of appending to the bottom.

### Styling heuristics

- Keep one-off spacing, layout, and visibility decisions inline with the owning component.
- Promote a pattern to `index.css` only when it is reused across surfaces and has stable semantics.
- Prefer semantic class names such as `surface-panel`, `status-pill`, or `field-shell` over screen-specific names.
- Keep shared presentational components in `components/ui` dumb; product logic stays in feature folders.

## Common change paths

### Add or change a visible renderer feature

1. Start in the owning feature folder under `components/`.
2. Update the nearest Zustand store if state ownership changes.
3. Update hooks if the behavior spans shortcuts, autorun, or runtime orchestration.
4. Update i18n keys for visible text.
5. Update docs if the change touches shortcuts, runner behavior, layout behavior, or workflows.

### Change execution behavior

Touch these areas together:

- [`hooks/useRunner.ts`](hooks/useRunner.ts)
- [`stores/resultStore.ts`](stores/resultStore.ts)
- the relevant file in [`runners/`](runners)
- [`utils/executionPresentation.ts`](utils/executionPresentation.ts) when output formatting changes

### Change editor behavior

Touch these areas together:

- [`components/Editor/CodeEditor.tsx`](components/Editor/CodeEditor.tsx)
- [`components/Editor/editorOptions.ts`](components/Editor/editorOptions.ts)
- [`monaco.ts`](monaco.ts)
- completion providers in [`components/Editor/completionProviders/`](components/Editor/completionProviders)

### Change shell or modal behavior

Touch these areas together:

- [`App.tsx`](App.tsx) for top-level overlay ownership
- [`components/Layout/AppLayout.tsx`](components/Layout/AppLayout.tsx) for shell layout and panel structure
- [`stores/uiStore.ts`](stores/uiStore.ts) for transient shell state
- [`index.css`](index.css) if the change introduces a shared shell primitive

## Testing map

Keep tests close to the behavior they validate, even though the repository uses a top-level `tests/` directory.

| Change area                             | Tests to check first                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| Monaco/editor bootstrap                 | `tests/monaco.test.ts`, `tests/completionProviders.test.ts`                   |
| Shell layout and modal behavior         | `tests/components/AppLayout.test.tsx`, relevant modal tests                   |
| Settings UX                             | `tests/components/SettingsModal.test.tsx` plus section-specific tests         |
| File/project tree logic                 | `tests/stores/projectStore.test.ts`, tree-related component tests             |
| Execution formatting and inline results | `tests/utils/executionPresentation.test.ts`, runner tests, result panel tests |
| i18n copy plumbing                      | `npm run check:i18n` and `npm run check:i18n:copy`                            |

## Anti-patterns to avoid

- Putting feature state into `App.tsx` when a store already owns that concept.
- Adding generic `shared`, `helpers`, or app-wide barrel layers that hide ownership.
- Storing translated labels in store state instead of resolving them at render time.
- Mixing React orchestration, pure formatting, and side-effectful runtime work in one file.
- Adding global CSS for a pattern that only exists in one component.

## Change hygiene

- Keep feature copy resolved at render sites with `t(...)`; do not store translated labels in config/state.
- Prefer pure helpers beside the store when tree shaping or result formatting gets complex.
- Preserve the current feature-folder organization; avoid generic barrel-style “shared app utils” growth.
- If a file crosses roughly 250-300 lines and has more than one concern, split by feature boundary, not by arbitrary helper extraction.

## Related documents

- [README.md](../../README.md) for setup, build, validation, and release operations
- [ARCHITECTURE.md](../../docs/ARCHITECTURE.md) for project lifecycle, file-system IPC, and watch-state flow
