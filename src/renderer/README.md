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
| [monaco.ts](monaco.ts) | Monaco workers + lazy per-language registration via `registerLanguageOnce`: JS/TS pre-registered, every other language's tokenizer + providers load on first activation |

## Folder map

| Path                                                                                | What belongs there                                                        |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`components/`](components) | User-visible UI grouped by feature surface                                |
| [`stores/`](stores)         | Zustand stores and pure helpers that own renderer state                   |
| [`hooks/`](hooks)           | React hooks that coordinate stores, runners, shortcuts, and shell effects |
| [`runners/`](runners)       | Language-specific execution adapters and result shaping                   |
| [`runtime/`](runtime)       | Cross-surface runtime orchestration: manual run, notebooks, debugger, HTTP/SQL clients, capsule builders |
| [`services/`](services)     | Renderer-side HTTP clients for license, trial, education, recovery, update, and web dependency flows |
| [`languageSupport/`](languageSupport) | Declarative editor/language descriptors consumed by Monaco and language intelligence |
| [`languageIntelligence/`](languageIntelligence) | Renderer adapters for diagnostics, completion, hover, and signature help; `lspRequest.ts` unwraps the shared IPC Result once |
| [`lint/`](lint)             | Inline-lint rules + quick-fix provider Monaco's TS worker does not cover |
| [`clipboard/`](clipboard)   | Smart-paste detectors + intent router that delegate pasted artifacts to existing importers |
| [`validation/`](validation) | Validate-only document checks for non-runnable development files          |
| [`workers/`](workers)       | Web Worker entry points for JS/TS/Python/Go browser execution plus large diff and Utility Pipeline compute |
| [`utils/`](utils)           | Framework-agnostic helpers and renderer-specific utilities                |
| [`data/`](data)             | Static templates and catalog data                                         |
| [`i18n/`](i18n)             | Async translation bootstrap: English is initial; Spanish loads on demand before mount/language change |
| [`themes/`](themes)         | Monaco/editor theme definitions                                           |
| [`plugins/`](plugins)       | Renderer-side plugin catalog, diagnostics, and safe runtime hooks         |
| [`onboarding/`](onboarding) | First-run scratchpad seed and guided-start helpers                        |
| [`testing/`](testing)       | Test-only renderer harness helpers                                        |
| [`types/`](types)           | Renderer-local type declarations that should not leak into shared code    |
| [`devShowcase/`](devShowcase) | Local visual/system showcase utilities, not product runtime code        |

### Magic-comment boundaries

Keep the always-mounted Git surfaces separate from the transformation engine:

- [`utils/gitMagicCommentPolicy.ts`](utils/gitMagicCommentPolicy.ts) owns the
  lightweight `@git-status-off` and `@git-watch-head-off` buffer predicates
  used by Git detection, status, and tab affordances.
- [`utils/magicComments.ts`](utils/magicComments.ts) owns source
  transformations and presentation directives. It stays behind editor-provider
  and execution boundaries; Git consumers must not import it.
- [`testing/RichConsoleE2eFixture.tsx`](testing/RichConsoleE2eFixture.tsx) is
  reached from the web entry through a conditional `import()` only. A static
  import would put the complete Console tree back into normal web startup.

## Component surfaces

The renderer is intentionally split by feature instead of by component type.

| Feature folder                                                                                                    | Main files                                            | Notes                                                          |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| [`components/Layout/`](components/Layout)                 | `AppLayout.tsx`, `BottomPanel.tsx`                    | Owns shell composition, panel layout, sidebar/drawer behavior; the closed bottom panel stays behind a lazy boundary so its feature tree loads only when opened |
| [`components/Chrome/`](components/Chrome)                 | `AppChrome.tsx`                                       | App-level chrome frame and shell wrapper primitives            |
| [`components/a11y/`](components/a11y)                     | `LiveAnnouncer.tsx`                                   | Single polite `aria-live` region for screen-reader announcements |
| [`components/Editor/`](components/Editor)                 | `CodeEditor.tsx`, `EditorTabs.tsx`, `EditorTabContextMenuHost.tsx`, `ResultPanel.tsx` | Owns Monaco, eager tab orchestration/rows, activation-scoped tab actions, inline result surface, completion providers |
| [`components/ErrorBoundary/`](components/ErrorBoundary)   | `ErrorBoundary.tsx`                                   | Render-crash containment and fallback surfaces                 |
| [`components/FileTree/`](components/FileTree)             | `FileTreeHost.tsx`, `FileTree.tsx`, `FileTreeNode.tsx` | Owns the activation boundary, project explorer rendering, and inline tree interactions |
| [`components/Toolbar/`](components/Toolbar)               | `FloatingActionPill.tsx`, `Toolbar.tsx`, `executionControlPolicy.ts` | AppLayout mounts the floating execution chrome only; the standalone Toolbar supports focused fallback/smoke coverage and shares the same pure eligibility policy |
| [`components/Settings/`](components/Settings)             | `SettingsModal.tsx` plus section files                | Split by settings domain instead of one monolith               |
| [`components/CommandPalette/`](components/CommandPalette) | `CommandPalette.tsx`, `useCommandPaletteCommands.ts`, `commandPaletteModel.ts` | Thin combobox UI plus store-backed catalog orchestration and pure model logic |
| [`components/ContextualHints/`](components/ContextualHints) | `ContextualHint.tsx` | Platform-aware guidance and persisted opt-out for empty product surfaces |
| [`components/Console/`](components/Console)               | `ConsolePanel.tsx`                                    | Runtime logs, filters, output actions                          |
| [`components/GuidedTour/`](components/GuidedTour)         | `GuidedTourProvider.tsx`, step helpers                | First-run tour orchestration and target selectors              |
| [`components/Notebook/`](components/Notebook)             | `NotebookView.tsx`, `NotebookToolbar.tsx`, `NotebookCellList.tsx`, cell rows | Notebook orchestration, toolbar/export lifecycle, virtualized cells, keyboard command mode |
| [`components/DeveloperUtilities/`](components/DeveloperUtilities) | utility panel files                           | 31 utility panels plus panel-specific validation/output UX      |
| [`components/Dependencies/`](components/Dependencies)     | `DependenciesPanel.tsx`                               | JS/TS and Python dependency detection/install surfaces          |
| [`components/BrowserPreview/`](components/BrowserPreview) | `BrowserPreviewPanel.tsx`                             | Iframe preview panel and active iframe bridge integration       |
| [`components/Debugger/`](components/Debugger)             | `DebuggerDrawer.tsx`                                  | JS/TS debugger drawer controls and paused-frame display         |
| [`components/AI/`](components/AI)                         | `ExplainErrorDialog.tsx`                              | BYO-key "Explain this error" consent + result dialog       |
| [`components/HttpWorkspace/`](components/HttpWorkspace)   | `HttpWorkspacePanel.tsx`                              | HTTP request workspace, response preview, capsule creation      |
| [`components/ImportPreview/`](components/ImportPreview)   | `ImportPreviewOverlay.tsx`, `ImportPreviewBody.tsx`   | cURL, `.ipynb`, Postman, and Bruno preview before opening workspace tabs |
| [`components/KeyboardShortcuts/`](components/KeyboardShortcuts) | `KeyboardShortcutsModal.tsx`                   | Shortcut editor modal and preset import/export UI              |
| [`components/NativeExecutionWarning/`](components/NativeExecutionWarning) | `NativeExecutionWarning.tsx`             | Desktop-native runtime warning copy                            |
| [`components/SqlWorkspace/`](components/SqlWorkspace)     | `SqlWorkspacePanel.tsx`, `SqlResultPreview.tsx`, preview parts/actions | DuckDB SQL workspace, schema browser, result orchestration and focused table/export UI |
| [`components/CapsuleImport/`](components/CapsuleImport)   | `CapsuleImportOverlay.tsx`                            | Run Capsule import validation and open/focus routing            |
| [`components/CapsuleList/`](components/CapsuleList)       | `CapsuleListOverlay.tsx`                              | Capsule browsing, filters, and replay affordances              |
| [`components/ProjectSearch/`](components/ProjectSearch)   | `ProjectSearch.tsx`                                   | Project-wide search, result selection, and reveal routing      |
| [`components/ProjectReplace/`](components/ProjectReplace) | `ProjectReplaceOverlay.tsx`                           | Project-wide replacement preview/apply flow                    |
| [`components/ProjectBundle/`](components/ProjectBundle)   | bundle import/export overlays                         | Project bundle import/export UX; the shared archive codec loads only after an explicit export/import action |
| [`components/GoToSymbol/`](components/GoToSymbol)         | `GoToSymbol.tsx`                                      | Current-document symbol filtering and same-tab reveal routing  |
| [`components/QuickOpen/`](components/QuickOpen)           | `QuickOpen.tsx`                                       | Open-tab, recent-file, and project-index file navigation       |
| [`components/Share/`](components/Share)                   | `ShareLinkButton.tsx`, `ShareLinkController.tsx`, lazy flow + confirmation modal | Startup-safe share affordance, activation, generation, and copied-link feedback |
| [`components/Snippets/`](components/Snippets)             | `SnippetsModal.tsx`                                   | Snippet browser and insert flow                                |
| [`components/StatusBar/`](components/StatusBar)           | `StatusBar.tsx`, `useStatusBarModel.ts`              | Persistent 24px bottom bar: language, lint, cursor, indent, Git |
| [`components/StatusNotice/`](components/StatusNotice)     | `StatusNoticeBanner.tsx`                              | Global status-notice banner rendering                          |
| [`components/Welcome/`](components/Welcome)               | welcome/project template overlays                     | Empty-state entry points and project template launcher          |
| [`components/Recipes/`](components/Recipes)               | `RecipesOverlay.tsx`, `RecipeRunPanel.tsx`            | Recipe browser, tab binding, assertion runner panel            |
| [`components/ui/`](components/ui)                         | `chrome.tsx`, `keyboard.ts`                           | Shared presentational primitives only                          |

Keyboard shortcuts use two data layers with different activation costs:

- [`data/keyboardShortcuts.ts`](data/keyboardShortcuts.ts) is the
  startup-safe structural catalog. Keep ids, groups, default combos, matching,
  overrides, and display formatting here because global dispatch and compact
  key hints need them before any overlay opens.
- [`data/keyboardShortcutReference.ts`](data/keyboardShortcutReference.ts)
  owns localized label/description keys, group labels, and search keywords.
  Import it only from the lazy Settings and Keyboard Shortcuts surfaces so
  reference presentation does not join every workspace startup.
- `ShortcutId` is derived from the structural catalog and the metadata record
  must satisfy that union, making missing or stale reference rows a compile
  error.

Developer Utilities use separate startup and implementation layers:

- [`data/developerUtilities.ts`](data/developerUtilities.ts) is the
  always-reachable catalog. Keep it limited to identifiers, search copy,
  aliases, and entitlement metadata.
- [`utils/developerUtilityDetection.ts`](utils/developerUtilityDetection.ts)
  owns cheap synchronous predicates shared by Smart Paste and panel Apply
  eligibility.
- [`data/developerUtilityDetectors.ts`](data/developerUtilityDetectors.ts)
  exhaustively maps every utility id to a predicate or an explicit `null`.
  It is imported from the lazy panel primitives, not from the catalog.
- [`utils/developerUtilities.ts`](utils/developerUtilities.ts) owns the full
  analyzers and transformations. It loads with utility panels that use those
  implementations rather than with the workspace shell.

Renderer-local language intelligence also stays activation-scoped:

- [`languageSupport/registry.ts`](languageSupport/registry.ts) contains
  startup-safe descriptors for every language. Descriptors may advertise a
  `loadLanguageIntelligenceAdapter` function, but must not import an analyzer
  implementation at module scope.
- [`languageIntelligence/index.ts`](languageIntelligence/index.ts) caches one
  asynchronous adapter load per language and drops failed loads so a later
  activation can retry.
- [`hooks/useLanguageIntelligenceDiagnostics.ts`](hooks/useLanguageIntelligenceDiagnostics.ts)
  waits for the active-language debounce before requesting an adapter. Python
  and Ruby analysis therefore arrives with a matching editor tab instead of
  with the JavaScript-first workspace shell.

The opt-in Run Ledger has a similar persistence boundary:

- [`hooks/useRunLedgerTap.ts`](hooks/useRunLedgerTap.ts) keeps only the
  execution-history subscription and the persisted opt-in check at startup.
- [`runtime/runLedger.ts`](runtime/runLedger.ts) and
  [`runtime/duckdbClient.ts`](runtime/duckdbClient.ts) load on the first new
  manual run after the user enables the ledger. Opening their explicit
  Settings or SQL surfaces may also load them.
- Runs observed while the setting is off are marked seen but never imported or
  recorded retroactively. Chunk-load failures remain best-effort and retry on
  the next enabled run.

The guided tour keeps its startup contract separate from its visual engine:

- [`components/GuidedTour/GuidedTourProvider.tsx`](components/GuidedTour/GuidedTourProvider.tsx)
  keeps the stable context, completion flag, and activation request in the
  workspace graph.
- [`components/GuidedTour/GuidedTourRuntime.tsx`](components/GuidedTour/GuidedTourRuntime.tsx)
  owns step positioning, focus management, selector polling, and tour UI. It
  loads only when first-run auto-start or an explicit launcher requests a tour.
- Runtime load failures clear the loader cache for retry and push a localized
  status notice instead of leaving the request without feedback.

The Electron-only desktop smoke harness is activation-scoped as well:

- [`hooks/useDesktopSmoke.ts`](hooks/useDesktopSmoke.ts) keeps only the
  bridge-enabled effect in the workspace startup graph.
- [`hooks/desktopSmokeRunner.ts`](hooks/desktopSmokeRunner.ts) owns the smoke
  cases, artifact generation, memory snapshots, and execution loop. It loads
  only after Electron injects the desktop-smoke bridge.
- A runner chunk or startup failure reports `finish(false)` to the smoke
  controller instead of leaving CI waiting for its outer timeout.

Telemetry also has an explicit loading boundary:

- [`utils/telemetry.ts`](utils/telemetry.ts) is the stable call-site facade.
  Keep direct `trackEvent` consumers on this path so configured consent is
  checked before any delivery implementation loads.
- [`utils/telemetryPolicy.ts`](utils/telemetryPolicy.ts) owns the lightweight
  endpoint, kill-switch, and persisted-consent preflight. Invalid endpoints
  still warn once without loading the emitter.
- [`utils/telemetryEmitter.ts`](utils/telemetryEmitter.ts) owns base fields,
  redaction, trust-ledger capture, and best-effort network delivery. It must
  remain dynamically reachable only after the policy allows an event.
- [`../shared/bootTelemetry.ts`](../shared/bootTelemetry.ts) contains the small
  boot phase and duration-bucket vocabulary needed before first paint. The
  complete event catalog and redactor remain in
  [`../shared/telemetry.ts`](../shared/telemetry.ts) behind the emitter boundary.

Sharing separates its always-available triggers from both implementations:

- [`components/Share/ShareLinkButton.tsx`](components/Share/ShareLinkButton.tsx)
  and
  [`components/Share/ShareLinkController.tsx`](components/Share/ShareLinkController.tsx)
  keep the visible affordance, command listener, and localized loading/error
  shell in the startup graph.
- [`components/Share/ShareLinkFlow.tsx`](components/Share/ShareLinkFlow.tsx)
  owns outgoing encoding, confirmation, clipboard writes, and terminal
  telemetry. It loads only after a button, palette, or shortcut request.
- [`hooks/useShareLinkBoot.ts`](hooks/useShareLinkBoot.ts) inspects only the
  small protocol prefix. A matching URL fragment loads
  [`hooks/shareLinkImport.ts`](hooks/shareLinkImport.ts), while ordinary and
  foreign hashes never download the codec or tab importer.
- Smart Paste recognizes the small protocol prefix with the editor, but
  [`clipboard/applyPasteIntent.ts`](clipboard/applyPasteIntent.ts) loads the
  codec only after the user accepts an actual share-link import.
- Both loaders cache successful chunks and evict rejected loads, so a
  transient failure closes with localized feedback and the next explicit
  action or reload can retry.

Result comparison has its own activation boundary:

- [`components/Editor/ResultPanel.tsx`](components/Editor/ResultPanel.tsx)
  keeps the stable-snapshot gate and decides when Compare owns the result body.
- [`components/Editor/CompareResultsPanelHost.tsx`](components/Editor/CompareResultsPanelHost.tsx)
  provides localized loading and reload states without importing the diff
  implementation.
- [`components/Editor/CompareResultsPanel.tsx`](components/Editor/CompareResultsPanel.tsx),
  [`hooks/useComputedDiff.ts`](hooks/useComputedDiff.ts), and the worker client
  load together only after the user enables Compare.
- A successful chunk is reused for later comparisons. A rejected module load
  offers an explicit page reload because browsers retain failed module URLs in
  the current document's module map.

The project explorer follows the same document-safe boundary:

- [`components/Layout/AppLayout.tsx`](components/Layout/AppLayout.tsx) keeps
  sidebar and compact-drawer layout, focus, and dismissal behavior eager.
- [`components/FileTree/FileTreeHost.tsx`](components/FileTree/FileTreeHost.tsx)
  mounts only while either sidebar is visible and owns localized loading and
  reload states.
- [`components/FileTree/FileTree.tsx`](components/FileTree/FileTree.tsx), its
  recursive rows, context actions, open-tabs footer, and list windower load
  together on the first sidebar activation and are reused for later opens.
- A rejected module load remains cached for the current document and offers an
  explicit page reload rather than a retry that browsers cannot honor reliably.

The floating Variables inspector also stays behind its actual visibility gate:

- [`components/Editor/FloatingVariablesCardHost.tsx`](components/Editor/FloatingVariablesCardHost.tsx)
  watches primitive active-tab eligibility, the selected surface, and matching
  scope snapshot without re-rendering on editor keystrokes.
- [`components/Editor/FloatingVariablesCard.tsx`](components/Editor/FloatingVariablesCard.tsx)
  owns the portal, drag lifecycle, value rows, collapse state, and close action.
  It loads only after Variables is enabled on a supported non-Node tab.
- The loader retains a failed module request for the document and the host
  offers localized loading and reload states instead of an unreliable inline
  retry.

Recent Runs keeps its discoverable shell separate from its paid implementation:

- [`components/Editor/RecentRunsPill.tsx`](components/Editor/RecentRunsPill.tsx)
  owns the visible per-tab count, Free upsell, global opener registration, and
  dismissal behavior. Primitive active-tab selectors keep ordinary buffer
  edits from re-rendering this boundary.
- [`components/Editor/RecentRunsPopoverHost.tsx`](components/Editor/RecentRunsPopoverHost.tsx)
  and
  [`components/Editor/recentRunsPopoverLoader.ts`](components/Editor/recentRunsPopoverLoader.ts)
  provide localized loading/reload states and one cached module request per
  document.
- [`components/Editor/RecentRunsPopover.tsx`](components/Editor/RecentRunsPopover.tsx)
  owns the rows, relative-time interval, pin/replay controls, runner
  integration, and related icons. It loads only after an eligible Pro user
  opens Recent Runs.
- A failed module URL remains cached for the current document because browsers
  do not reliably recover it through an inline retry; the host offers an
  explicit Lingua reload instead.

Editor tabs keep their primary interaction path separate from contextual
actions:

- [`components/Editor/EditorTabs.tsx`](components/Editor/EditorTabs.tsx) and
  [`components/Editor/EditorTabItems.tsx`](components/Editor/EditorTabItems.tsx)
  keep tab rendering, activation, close, rename, overflow, and the
  right-click/Shift+F10 detector eager.
- [`components/Editor/EditorTabContextMenuHost.tsx`](components/Editor/EditorTabContextMenuHost.tsx)
  loads the implementation after activation; a failed request closes and uses
  the shared status-notice surface for localized reload guidance.
- [`components/Editor/EditorTabContextMenu.tsx`](components/Editor/EditorTabContextMenu.tsx)
  owns the portal actions, action keyboard navigation, and focus restoration.
  Its document-cached loader fetches it only after an actual context-menu
  request.
- The implementation bounds its fixed portal anchor to the viewport so edge
  activations do not clip contextual actions.

Run Capsule export keeps capture and discoverability separate from delivery:

- [`components/Editor/RunCapsuleExportButtonHost.tsx`](components/Editor/RunCapsuleExportButtonHost.tsx)
  observes only whether the in-memory execution history has a capsule; a fresh
  workspace renders no unavailable control and requests no export code.
- [`components/Editor/runCapsuleExportLoader.ts`](components/Editor/runCapsuleExportLoader.ts)
  owns document-cached module requests for the result-header control and the
  shared clipboard pipeline.
- [`components/Editor/RunCapsuleExportButton.tsx`](components/Editor/RunCapsuleExportButton.tsx)
  receives the already-selected capsule and owns copied feedback plus the
  rich-output marker. The Mod+Shift+X shortcut loads the same export pipeline
  only after confirming a capsule exists.
- Failed control or pipeline chunks log diagnostic context and surface
  localized reload guidance through the global status-notice surface.

The main-editor AI explanation flow keeps its request slot separate from its
paid implementation:

- [`components/AI/AiExplainCodeHost.tsx`](components/AI/AiExplainCodeHost.tsx)
  stays mounted as the single subscriber shared by the editor and Command
  Palette, but contains only the activation and localized loading/error shell.
- [`components/AI/ExplainCodeDialog.tsx`](components/AI/ExplainCodeDialog.tsx),
  its consent payload builder, answer renderer, and `runtime/aiClient.ts`
  transport load only after an explicit explain-code request.
- A failed dialog chunk closes the failed request, clears the loader cache, and
  lets the next explicit action retry without replacing the app shell.

## State ownership

### User-invoked overlays

`App.tsx` owns one `AppOverlay` value for Settings, palettes, search,
Snippets, Recipes, importers, and every other user-invoked modal surface.
Opening one replaces the previous value; feature stores must not add parallel
`overlayOpen` flags. Domain state can outlive the overlay — for example, recipe
bindings remain in `recipeStore` after the Recipes browser closes — but
visibility stays in the single App slot.

The guided tour is a separate, short-lived onboarding layer. It closes any
existing App overlay before starting and yields when a shortcut opens one. Its
task flow stays on the editor, Run action, and console; it must not open a
second modal from inside a tour step.

### Settings discovery

Settings search uses the curated catalog in
`components/Settings/settingsSearchModel.ts`, not the mounted DOM. Only one
Settings tab is mounted at a time, so DOM search would silently miss controls
in every other tab. Catalog entries map localized labels, descriptions, and
cross-language aliases to a tab plus a stable focus target. Selecting a result
switches tabs, scrolls to the target, and moves keyboard focus there.

Use the closest store that already owns the product concept instead of adding cross-cutting state to `App.tsx`.

| Store                                                                                               | Owns                                                              |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [editorStore.ts](stores/editorStore.ts)     | tabs, active editor session, file/language metadata, pending reveal requests — thin assembly point that composes the focused editor\* modules below |
| editor split — pure helpers: [editorStoreContext.ts](stores/editorStoreContext.ts) (shared `EditorSet`/`EditorGet` types), [editorModeHelpers.ts](stores/editorModeHelpers.ts) (runtime/workflow mode resolution), [editorTabUtils.ts](stores/editorTabUtils.ts) (tab helpers, capability droppers, workspace consts, `createDefaultTab`), [editorPersistence.ts](stores/editorPersistence.ts) (format-on-save + `persistTab`), [editorSelectors.ts](stores/editorSelectors.ts) (`getActiveTab`/`getActiveTabIndex`) | leaf helpers the assembly + consumers import; no store-cycle |
| editor split — action factories: [editorTabActions.ts](stores/editorTabActions.ts) (create/restore/remove/focus/duplicate), [editorWorkspaceActions.ts](stores/editorWorkspaceActions.ts) (notebook + SQL/HTTP openers), [editorContentActions.ts](stores/editorContentActions.ts) (buffer/exec-state/timeout/recipe-clear), [editorModeActions.ts](stores/editorModeActions.ts) (runtime/workflow mode + capability toggles), [editorInputActions.ts](stores/editorInputActions.ts) (stdin/argv/named input sets), [editorSaveActions.ts](stores/editorSaveActions.ts) (open/save/save-as), [editorCloseActions.ts](stores/editorCloseActions.ts) (close + bulk + rename) | `(set, get) => Pick<EditorState, …>` slices spread into `useEditorStore` |
| [resultStore.ts](stores/resultStore.ts)     | inline results, diagnostics, shared manual-run lifecycle, run timing, compare snapshots, variable scope |
| [consoleStore.ts](stores/consoleStore.ts)   | console entries and runtime output filters                        |
| [announcerStore.ts](stores/announcerStore.ts) | shared polite screen-reader announcer (drives `LiveAnnouncer`)   |
| [projectStore.ts](stores/projectStore.ts)   | active project lifecycle and explorer tree state                  |
| [notebookStore.ts](stores/notebookStore.ts) | per-tab notebook cells, outputs, transient run state, active cell — thin assembly point (internal pattern) that composes the focused notebook\* modules below |
| notebook split — [notebookStoreContext.ts](stores/notebookStoreContext.ts) (shared `NotebookSet`/`NotebookGet` types) + action factories: [notebookLifecycleActions.ts](stores/notebookLifecycleActions.ts) (create/install-imported/dispose/rename), [notebookCellActions.ts](stores/notebookCellActions.ts) (add/remove/undo-delete/update-source/transform/set-language/move), [notebookRunActions.ts](stores/notebookRunActions.ts) (outputs/run-status/duration/var-flow/execution-order/clear/restart), [notebookUiActions.ts](stores/notebookUiActions.ts) (active-cell/scroll-top), [notebookSelectors.ts](stores/notebookSelectors.ts) (get-notebook/run-status/execution-order/active-cell) | `(set, get) => Pick<NotebookState, …>` slices spread into `useNotebookStore` |
| [dependencyDetectionStore.ts](stores/dependencyDetectionStore.ts) + [useDependencyDetection.ts](hooks/useDependencyDetection.ts) | per-tab dependency cache/install state plus debounced, cancellable adapter loading; the detection path requests Acorn or the Python scanner only when active source may reference a package (Scratchpad execution can load its shared Acorn chunk independently) |
| [gitStore.ts](stores/gitStore.ts)           | git posture, per-file status cache, HEAD-change updates           |
| [executionHistoryStore.ts](stores/executionHistoryStore.ts) | run history, snapshots, capsules, comparison anchors             |
| [presenterModeStore.ts](stores/presenterModeStore.ts) | session-only presenter/focus mode flag read at render time by the chrome |
| [bootstrapProgressStore.ts](stores/bootstrapProgressStore.ts) | live WASM runtime download progress feeding the action pill label |
| [commandHistoryStore.ts](stores/commandHistoryStore.ts) | per-session ring of executed palette actions (internal Cmd+; recent stack) |
| [debuggerStore.ts](stores/debuggerStore.ts) | debugger breakpoints, paused frames, watch/logpoint state         |
| [licenseStore.ts](stores/licenseStore.ts)   | license token, verification status, device/recovery metadata — thin factory+facade that picks web vs desktop and re-exports the public types |
| license split — shared leaves: [licenseTypes.ts](stores/licenseTypes.ts) (`LicenseStatus`/`ServerSyncState`/`RecoverHint`/`LicenseState` + status consts + `LicenseSet`/`LicenseGet`), [licenseBridge.ts](stores/licenseBridge.ts) (`readLicenseBridge` + `LicenseBridge`, including the single IPC Result compatibility adapter), [licenseWebVerify.ts](stores/licenseWebVerify.ts) (embedded Ed25519 key + local verify), [licenseServerMappers.ts](stores/licenseServerMappers.ts) (server verdict → local status), [licenseTokenHelpers.ts](stores/licenseTokenHelpers.ts) (issuedAt/issuedTo decode + stale-token pickup) | imported by both flows; no facade cycle |
| license split — web flow: [licenseWebActions.ts](stores/licenseWebActions.ts) (setLicenseToken/clearLicense/removeDevice/clearRecoverHint), [licenseWebRevalidate.ts](stores/licenseWebRevalidate.ts) (revalidate), [licenseWebStore.ts](stores/licenseWebStore.ts) (state creator + persist + cross-tab); desktop flow: [licenseDesktopStore.ts](stores/licenseDesktopStore.ts) (bridge-delegating, no persist) | the two stores never import each other |
| [licenseSelectors.ts](stores/licenseSelectors.ts) | non-React tier selectors (`currentEffectiveTier`/`tierFromStatus`); lives with the stores so store modules never import from the hooks layer (re-exported by `hooks/useEntitlement`) |
| [licenseTrustCapture.ts](stores/licenseTrustCapture.ts) | implementation note — records a `license` trust event on each verify (active/grace); wired by the facade so the seam stays thin |
| [envVarsStore.ts](stores/envVarsStore.ts)   | execution environment-variable tiers and validation state         |
| [workspaceSqlStore.ts](stores/workspaceSqlStore.ts) | SQL workspace drafts, schema/result state                         |
| [workspaceToolStore.ts](stores/workspaceToolStore.ts) | HTTP/tool workspace drafts and active workspace metadata          |
| [goLanguageStore.ts](stores/goLanguageStore.ts), [rustLanguageStore.ts](stores/rustLanguageStore.ts), [lspLanguageStoreFactory.ts](stores/lspLanguageStoreFactory.ts) | desktop LSP detection/status state for Go and Rust |
| [nativeExecutionGateStore.ts](stores/nativeExecutionGateStore.ts) | per-language native execution warning acknowledgements            |
| [projectIndexStore.ts](stores/projectIndexStore.ts), [recentFilesStore.ts](stores/recentFilesStore.ts) | project indexing and recent-file ordering                         |
| [sessionStore.ts](stores/sessionStore.ts) | persisted editor-session snapshot and restore translation          |
| [settingsStore.ts](stores/settingsStore.ts) | sanitized persisted preferences, theme/keymap packs, consent and onboarding flags — thin `create(persist(...))` assembly point that composes the focused settings\* modules below |
| settings split — pure helpers: [settingsStoreContext.ts](stores/settingsStoreContext.ts) (shared `SettingsSet`/`SettingsGet` types), [settingsDefaults.ts](stores/settingsDefaults.ts) (seed consts + `createInitialSettingsState`), [settingsSanitizers.ts](stores/settingsSanitizers.ts) (rehydrate/runtime value narrowing + `sanitizeShortcutOverrides`), [settingsPersistence.ts](stores/settingsPersistence.ts) (`partialize` + consent mirror), [settingsMerge.ts](stores/settingsMerge.ts) (the persist `merge` rehydrate sanitizer) | leaf helpers the assembly + consumers import; no store-cycle |
| settings split — action factories: [settingsAppearanceActions.ts](stores/settingsAppearanceActions.ts) (theme/font/layout/keymap/shortcuts), [settingsRuntimeActions.ts](stores/settingsRuntimeActions.ts) (execution/runtime-mode/workflow/auto-log/timeout/ruby), [settingsPrivacyActions.ts](stores/settingsPrivacyActions.ts) (telemetry/clipboard consents + sensitive headers), [settingsSessionActions.ts](stores/settingsSessionActions.ts) (onboarding/tour/language/SQL workspace) | `(set[, get]) => Pick<SettingsState, …>` slices spread into `useSettingsStore` |
| [uiStore.ts](stores/uiStore.ts)             | transient shell visibility, status notices, bottom panel, floating positions |
| status notice API — [useStatusNotice.ts](hooks/useStatusNotice.ts) for React consumers and [statusNotice.ts](utils/statusNotice.ts) for imperative paths | tone-safe `info`/`success`/`warning`/`error` actions that preserve notice options while keeping direct store access out of producers |
| [commandBus.ts](stores/commandBus.ts) + [useCommandListener.ts](hooks/useCommandListener.ts) | closed-map, synchronous renderer commands with no replay/state updates; priority + handled fallback semantics keep app coordination off the global DOM event target |
| telemetry API — [useTelemetry.ts](hooks/useTelemetry.ts) for React consumers and [telemetry.ts](utils/telemetry.ts) for non-React layers | closed event names at call sites; a startup-safe facade checks consent and configuration before loading the full emitter |
| [updateStore.ts](stores/updateStore.ts)     | updater status, messages, last-check timing                       |
| [pluginStore.ts](stores/pluginStore.ts)     | local plugin discovery and diagnostics surface                    |
| [projectSearchStore.ts](stores/projectSearchStore.ts) / [projectReplaceStore.ts](stores/projectReplaceStore.ts) | project-wide search and replacement sessions |
| [snippetsStore.ts](stores/snippetsStore.ts), [recipeStore.ts](stores/recipeStore.ts), [lessonProgressStore.ts](stores/lessonProgressStore.ts) | user-created snippets, built-in recipe state, guided lesson progress |
| [trustEventStore.ts](stores/trustEventStore.ts) | Privacy + Trust event ledger surfaced in Settings                  |
| [utilityHistoryStore.ts](stores/utilityHistoryStore.ts), [utilityOutputStore.ts](stores/utilityOutputStore.ts), [utilityPipelineStore.ts](stores/utilityPipelineStore.ts) | Developer Utilities history, output, and pipeline state |
| [aiConfigStore.ts](stores/aiConfigStore.ts) | implementation — BYO-key AI config (endpoint/apiKey/model) on its own isolated `lingua-ai` persist boundary, kept out of the settings blob/exports/capsules/telemetry |
| [aiExplainCodeStore.ts](stores/aiExplainCodeStore.ts) | internal — single open-request slot for the "Explain this code" dialog so the editor context-menu action and the command palette open the same consent-first dialog (`AiExplainCodeHost`); session-only |

## Global action entry points

The Command Palette is the canonical text entry point for global actions. A
toolbar button, shortcut, empty state, status notice, or Settings CTA may expose
the same action contextually, but it must delegate to the same store/action
owner rather than maintain parallel state.

Primary task contracts:

| Task | Canonical text entry | Contextual/direct entry | Keyboard entry | Interaction budget |
| --- | --- | --- | --- | --- |
| Run the active tab | `Run active tab` | floating Run action | `Mod+Enter` | 1 direct or 3 through the palette |
| Change JS/TS runtime | `Switch runtime to …` | floating Runtime menu | `Mod+Alt+M` cycles modes | 2 direct or 3 through the palette |
| Open a project | `Open project folder…` | Explorer empty state / footer | Command Palette | 1 direct or 3 to the folder picker |
| Apply a license | `Apply license token` | license badge / Settings → Account | Command Palette | 5 through the palette, including paste + Apply |
| Restore a session | `Restore last session` when a snapshot exists | boot recovery notice | Command Palette | 1 direct or 3 through the palette |

`tests/components/CommandPalette.test.tsx` locks the palette budgets and action
ownership. `tests/components/SettingsModal.test.tsx` locks the lazy Settings
handoff and complete license-apply budget. Contextual controls have focused
component coverage in their owning feature.

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
- Every bespoke interactive control (chips, tree rows, status-bar segments, cell-row icon buttons, drop-zones, anything not built from the `.button-*` design-system classes) MUST carry a visible keyboard focus indicator. Reuse the shared `.focus-ring` class (defined in [index.css](index.css) beside the `.button-*` family) — or one of the `.button-*` / `.field-shell` primitives, which already include the ring — instead of hand-rolling a focus style. This keeps keyboard focus visible and consistent everywhere; do not invent a second ring recipe.

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
- [`runtime/executeTabManually.ts`](runtime/executeTabManually.ts)
- [`stores/resultStore.ts`](stores/resultStore.ts)
- the relevant file in [`runners/`](runners)
- [`utils/executionPresentation.ts`](utils/executionPresentation.ts) when output formatting changes

### Change notebook behavior

Touch these areas together:

- [`components/Notebook/`](components/Notebook) for visible cell, toolbar, command-mode, and export UX
- [`stores/notebookStore.ts`](stores/notebookStore.ts) for cells, outputs, transient run state, active cell, and persistence
- [`runtime/notebookSession.ts`](runtime/notebookSession.ts) for shared sandbox and per-cell execution semantics
- [`hooks/useNotebookRun.ts`](hooks/useNotebookRun.ts) for run-all/run-above orchestration, timing, telemetry, and variable-flow chips

### Change editor behavior

Touch these areas together:

- [`components/Editor/CodeEditor.tsx`](components/Editor/CodeEditor.tsx)
- [`components/Editor/editorOptions.ts`](components/Editor/editorOptions.ts)
- [`monaco.ts`](monaco.ts)
- completion providers in [`components/Editor/completionProviders/`](components/Editor/completionProviders)

### Change file or project navigation

Touch these areas together:

- [`components/QuickOpen/`](components/QuickOpen) for open-tab, recent-file, and project-index navigation UX
- [`components/ProjectSearch/`](components/ProjectSearch) and [`components/ProjectReplace/`](components/ProjectReplace) for project-wide content search flows
- [`stores/projectIndexStore.ts`](stores/projectIndexStore.ts), [`hooks/useProjectIndexSync.ts`](hooks/useProjectIndexSync.ts), and [`stores/recentFilesStore.ts`](stores/recentFilesStore.ts) for index freshness and recency ordering
- [`stores/projectStore.ts`](stores/projectStore.ts) when the change touches root capabilities, file-tree lifecycle, or watcher behavior

### Change shell or modal behavior

Touch these areas together:

- [`App.tsx`](App.tsx) for top-level overlay ownership
- [`components/Layout/AppLayout.tsx`](components/Layout/AppLayout.tsx) for shell layout and panel structure
- [`components/Settings/pendingSettingsTab.ts`](components/Settings/pendingSettingsTab.ts) for opening a specific Settings tab across the lazy overlay boundary; use `requestSettingsTab(...)` instead of delaying `settings.navigate` with timers or animation frames
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
| File/project navigation                 | `tests/components/QuickOpen.test.tsx`, `tests/components/ProjectSearch.test.tsx`, `tests/hooks/useProjectIndexSync.test.tsx`, `tests/stores/projectIndexStore.test.ts`, `tests/stores/recentFilesStore.test.ts` |
| Execution formatting and inline results | `tests/utils/executionPresentation.test.ts`, runner tests, result panel tests |
| Notebook behavior                       | `tests/stores/notebookStore.test.ts`, `tests/renderer/runtime/notebookSession.test.ts`, `tests/hooks/useNotebookRun.test.ts`, `tests/components/Notebook/*` |
| HTTP / SQL workspaces                   | `tests/renderer/runtime/httpClient.test.ts`, `tests/renderer/runtime/duckdbClient.test.ts`, workspace component tests |
| Language intelligence                   | `tests/languageIntelligence/*.test.ts`, `tests/languageSupportRegistry.test.ts` |
| Licensing / server services             | `tests/services/*.test.ts`, license section/device component tests            |
| i18n copy plumbing                      | `pnpm run check:i18n` and `pnpm run check:i18n:copy`                          |

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
