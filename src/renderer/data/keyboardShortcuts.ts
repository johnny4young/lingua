/**
 * Declarative catalog of the keyboard shortcuts that useGlobalShortcuts
 * dispatches. This file is the canonical list — the read-only reference
 * viewer, the command palette, and any future shortcut editor (RL-037)
 * should all read from here rather than re-deriving the set from the
 * handler. Keeping it pure (no React) means the catalog can be unit-tested
 * and validated against `useGlobalShortcuts` in isolation.
 */

export type ShortcutKeyToken =
  | 'Mod'
  | 'Shift'
  | 'Alt'
  | 'Enter'
  | 'Escape'
  | 'Backslash'
  | 'Comma'
  | string;

export interface ShortcutCombo {
  /** Ordered sequence of tokens. `Mod` resolves to Cmd on macOS, Ctrl elsewhere. */
  tokens: readonly ShortcutKeyToken[];
}

export type ShortcutGroupId =
  | 'run'
  | 'file'
  | 'navigation'
  | 'overlays'
  | 'view'
  | 'utilities'
  | 'debugger';

export interface ShortcutDefinition {
  id: string;
  group: ShortcutGroupId;
  labelKey: string;
  descriptionKey?: string;
  combos: readonly ShortcutCombo[];
  keywords: readonly string[];
}

export interface ShortcutGroupDefinition {
  id: ShortcutGroupId;
  labelKey: string;
}

export type ShortcutDisplayPlatform = 'darwin' | 'other';

export const SHORTCUT_GROUPS: readonly ShortcutGroupDefinition[] = [
  { id: 'run', labelKey: 'shortcuts.group.run' },
  { id: 'file', labelKey: 'shortcuts.group.file' },
  { id: 'navigation', labelKey: 'shortcuts.group.navigation' },
  { id: 'overlays', labelKey: 'shortcuts.group.overlays' },
  { id: 'view', labelKey: 'shortcuts.group.view' },
  // RL-069 Slice 1 — copy / replace clipboard from the focused
  // Developer Utilities panel without leaving the keyboard.
  { id: 'utilities', labelKey: 'shortcuts.group.utilities' },
  // RL-027 Slice 1 — debugger continue / step shortcuts.
  { id: 'debugger', labelKey: 'shortcuts.group.debugger' },
];

export const KEYBOARD_SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: 'run-toggle',
    group: 'run',
    labelKey: 'shortcuts.item.runToggle.label',
    descriptionKey: 'shortcuts.item.runToggle.description',
    combos: [{ tokens: ['Mod', 'Enter'] }],
    keywords: ['run', 'stop', 'execute'],
  },
  {
    // RL-019 Slice 1 fold D — cycle through the implemented JS/TS
    // runtime modes on the active tab. Slice 1 only has `worker`, so
    // the cycle is a no-op; Slice 2 and Slice 3 light up the same
    // shortcut as `node` and `browser-preview` come online.
    id: 'run-cycle-runtime-mode',
    group: 'run',
    labelKey: 'shortcuts.item.cycleRuntimeMode.label',
    descriptionKey: 'shortcuts.item.cycleRuntimeMode.description',
    combos: [{ tokens: ['Mod', 'Alt', 'M'] }],
    keywords: ['runtime', 'mode', 'worker', 'node', 'browser', 'cycle'],
  },
  {
    // RL-020 Slice 2 fold A — cycle the active tab's workflow mode
    // (Run → Debug → Scratchpad → Run) while skipping unsupported
    // segments for the language. Mirrors the `Mod+Shift+B`
    // breakpoint-toggle pattern from RL-027 Slice 1.5.
    id: 'run-cycle-workflow-mode',
    group: 'run',
    labelKey: 'shortcuts.item.cycleWorkflowMode.label',
    descriptionKey: 'shortcuts.item.cycleWorkflowMode.description',
    combos: [{ tokens: ['Mod', 'Shift', 'M'] }],
    keywords: ['workflow', 'mode', 'run', 'debug', 'scratchpad', 'cycle'],
  },
  {
    // RL-020 Slice 4 fold B — toggle the per-tab Recent Runs popover.
    // No-op when no pill is mounted (Free tier, view-only tab, or
    // empty per-tab history). Dispatcher in `App.tsx` consults the
    // `recentRunsPopoverBridge` module.
    id: 'run-toggle-recent-runs',
    group: 'run',
    labelKey: 'shortcuts.item.toggleRecentRuns.label',
    descriptionKey: 'shortcuts.item.toggleRecentRuns.description',
    // RL-024 Slice 2 — moved from Mod+Shift+H to Mod+Alt+H so the
    // VSCode-parity `Mod+Shift+H` binding can map to project-replace
    // (`nav-project-replace`). Alt+H still reads as "History" mnemonic
    // for power users.
    combos: [{ tokens: ['Mod', 'Alt', 'H'] }],
    keywords: ['history', 'recent', 'runs', 'replay', 'popover'],
  },
  {
    // RL-020 Slice 8 fold D — toggle the Compare panel on the active
    // tab. No-op when there's no comparator snapshot (matches the
    // toggle-button gate). Dispatcher in `App.tsx` reads + writes
    // `compareWithSnapshotEnabled` via the editor store.
    id: 'run-toggle-compare-snapshot',
    group: 'run',
    labelKey: 'shortcuts.item.toggleCompareSnapshot.label',
    descriptionKey: 'shortcuts.item.toggleCompareSnapshot.description',
    combos: [{ tokens: ['Mod', 'Shift', 'D'] }],
    keywords: ['compare', 'diff', 'snapshot', 'stable', 'previous'],
  },
  {
    // RL-020 Slice 9 fold C — toggle the Variables panel on the
    // active tab. No-op + notice when there's no scope snapshot.
    id: 'run-toggle-variable-inspector',
    group: 'run',
    labelKey: 'shortcuts.item.toggleVariableInspector.label',
    descriptionKey: 'shortcuts.item.toggleVariableInspector.description',
    combos: [{ tokens: ['Mod', 'Shift', 'I'] }],
    keywords: ['variables', 'inspector', 'scope', 'tree'],
  },
  // RL-093 Slice 3 — panel-chip shortcuts. Stdin chip mirrors the
  // Variables / Compare / History pattern with a single key combo
  // dedicated to the bottom-drawer chip.
  {
    id: 'editor-toggle-stdin-panel',
    group: 'run',
    labelKey: 'shortcuts.item.toggleStdin.label',
    descriptionKey: 'shortcuts.item.toggleStdin.description',
    combos: [{ tokens: ['Mod', 'Shift', 'E'] }],
    keywords: ['stdin', 'input', 'entrada', 'prompt'],
  },
  // RL-094 Slice 1.5 fold A — keyboard shortcut for the primary
  // result-panel export surface. `Mod+Shift+X` (eXport mnemonic).
  // `Mod+Shift+E` is already taken by stdin toggle; X is the next
  // most semantic unused slot.
  {
    id: 'run-export-capsule',
    group: 'run',
    labelKey: 'shortcuts.item.exportCapsule.label',
    descriptionKey: 'shortcuts.item.exportCapsule.description',
    combos: [{ tokens: ['Mod', 'Shift', 'X'] }],
    keywords: ['capsule', 'export', 'share', 'json', 'replay'],
  },
  // RL-036 Phase A1 fold D — keyboard shortcut for the share-link
  // copy flow. `Mod+Shift+L` (L for Link). Reviewer rebound from the
  // original `Mod+Shift+P` after discovering that combo was already
  // taken by `overlay-command-palette`; the first-match-wins iteration
  // in `useGlobalShortcuts` would otherwise have hijacked the Command
  // Palette opener. `Mod+Shift+L` is verified free against the catalog
  // by the conflict-free regression test in
  // `tests/data/keyboardShortcuts.test.ts`.
  {
    id: 'run-copy-share-link',
    group: 'run',
    labelKey: 'shortcuts.item.copyShareLink.label',
    descriptionKey: 'shortcuts.item.copyShareLink.description',
    combos: [{ tokens: ['Mod', 'Shift', 'L'] }],
    keywords: ['share', 'link', 'url', 'compartir', 'enlace', 'copy', 'copia'],
  },
  // RL-101 Slice 1 fold D — replay-onboarding shortcut. `Mod+Shift+W`
  // (W for Welcome). Verified free against the catalog by the
  // conflict-free regression test. Triggers all three reset setters
  // so the welcome scratchpad, first-run tip, and first-snippet tip
  // all re-arm on the next eligible event.
  {
    id: 'onboarding-replay',
    group: 'view',
    labelKey: 'shortcuts.item.replayOnboarding.label',
    descriptionKey: 'shortcuts.item.replayOnboarding.description',
    combos: [{ tokens: ['Mod', 'Shift', 'W'] }],
    keywords: [
      'onboarding',
      'welcome',
      'inicio',
      'guiado',
      'replay',
      'reset',
      'rearm',
    ],
  },
  // RL-093 Slice 3 — recover from a floating-pill/variables-card that
  // ended up in an unreachable position (off-screen monitor change,
  // bad localStorage value). Clears both persisted positions back to
  // the synchronous defaults computed by the components.
  {
    id: 'ui-reset-floating-positions',
    group: 'view',
    labelKey: 'shortcuts.item.resetFloating.label',
    descriptionKey: 'shortcuts.item.resetFloating.description',
    combos: [{ tokens: ['Mod', 'Shift', '0'] }],
    keywords: ['reset', 'floating', 'pill', 'variables', 'reposition'],
  },
  // RL-025 Slice A fold C — open the bottom-panel Dependencies tab
  // for the active file. `Mod+Shift+J` (J for JavaScript / packaJes
  // mnemonic — the easy unused slot). Verified free against the
  // catalog by the conflict-free regression test in
  // `tests/data/keyboardShortcuts.test.ts`. No-op + status notice
  // when there are no detected dependencies (the tab is hidden) or
  // when the master toggle is OFF.
  {
    id: 'view-show-dependencies',
    group: 'view',
    labelKey: 'shortcuts.item.showDependencies.label',
    descriptionKey: 'shortcuts.item.showDependencies.description',
    combos: [{ tokens: ['Mod', 'Shift', 'J'] }],
    keywords: [
      'dependencies',
      'imports',
      'requires',
      'modules',
      'paquetes',
      'dependencias',
    ],
  },
  {
    // RL-093 Slice 3 fold D — flip the variable inspector surface
    // (floating ↔ bottom). Distinct from `Mod+Shift+I` which toggles
    // the per-tab `variableInspectorEnabled` flag. Power-user shortcut
    // for moving Variables between surfaces without opening Settings.
    id: 'view-toggle-variable-inspector-surface',
    group: 'view',
    labelKey: 'shortcuts.item.toggleVariableInspectorSurface.label',
    descriptionKey: 'shortcuts.item.toggleVariableInspectorSurface.description',
    combos: [{ tokens: ['Mod', 'Shift', 'V'] }],
    keywords: ['variables', 'inspector', 'surface', 'dock', 'floating', 'bottom'],
  },
  {
    id: 'file-save',
    group: 'file',
    labelKey: 'shortcuts.item.save.label',
    combos: [{ tokens: ['Mod', 'S'] }],
    keywords: ['save'],
  },
  {
    id: 'file-save-as',
    group: 'file',
    labelKey: 'shortcuts.item.saveAs.label',
    combos: [{ tokens: ['Mod', 'Shift', 'S'] }],
    keywords: ['save', 'as', 'saveas'],
  },
  {
    id: 'file-open',
    group: 'file',
    labelKey: 'shortcuts.item.openFile.label',
    combos: [{ tokens: ['Mod', 'O'] }],
    keywords: ['open', 'file'],
  },
  {
    id: 'file-close-tab',
    group: 'file',
    labelKey: 'shortcuts.item.closeTab.label',
    combos: [{ tokens: ['Mod', 'W'] }],
    keywords: ['close', 'tab'],
  },
  {
    id: 'nav-quick-open',
    group: 'navigation',
    labelKey: 'shortcuts.item.quickOpen.label',
    combos: [{ tokens: ['Mod', 'P'] }],
    keywords: ['quick', 'open', 'fuzzy'],
  },
  {
    id: 'nav-go-to-symbol',
    group: 'navigation',
    labelKey: 'shortcuts.item.goToSymbol.label',
    combos: [{ tokens: ['Mod', 'Shift', 'O'] }],
    keywords: ['symbol', 'outline'],
  },
  {
    id: 'nav-project-search',
    group: 'navigation',
    labelKey: 'shortcuts.item.projectSearch.label',
    combos: [{ tokens: ['Mod', 'Shift', 'F'] }],
    keywords: ['search', 'find', 'project'],
  },
  {
    // RL-024 Slice 2 — Replace in files. Cmd+Shift+H mirrors the
    // VSCode binding so users with that muscle memory can find it
    // immediately.
    id: 'nav-project-replace',
    group: 'navigation',
    labelKey: 'shortcuts.item.projectReplace.label',
    combos: [{ tokens: ['Mod', 'Shift', 'H'] }],
    keywords: ['replace', 'substitute', 'find', 'project', 'rename'],
  },
  {
    // RL-097 Slice 1 — Toggle the HTTP workspace bottom-panel tab.
    // Mod+Shift+K is free in Lingua + not reserved by browsers
    // (Mod+Shift+R / +T / +N are all browser-reserved or already
    // taken). Tab stays in the tab strip once activated; this
    // shortcut toggles visibility.
    id: 'workspace-toggle-http',
    group: 'navigation',
    labelKey: 'shortcuts.item.httpWorkspace.label',
    combos: [{ tokens: ['Mod', 'Shift', 'K'] }],
    keywords: ['http', 'request', 'fetch', 'api', 'rest', 'workspace'],
  },
  {
    // RL-097 Slice 2 — Toggle the SQL workspace bottom-panel tab.
    // Mod+Alt+S (S for SQL) — verified free against the catalog.
    // Mod+Shift+Q rejected: macOS Cmd+Shift+Q is the OS-level log-out
    // shortcut and is intercepted by the system. Mod+Alt namespace is
    // less crowded (currently only +M / +H / +R are claimed).
    id: 'workspace-toggle-sql',
    group: 'navigation',
    labelKey: 'shortcuts.item.sqlWorkspace.label',
    combos: [{ tokens: ['Mod', 'Alt', 'S'] }],
    keywords: ['sql', 'query', 'duckdb', 'database', 'workspace'],
  },
  {
    // RL-099 Slice 1 fold A — Open the Developer Utilities overlay
    // with the Pipelines panel preselected. Mod+Shift+G (G for
    // Graph / pipeline; verified free vs the catalog — Mod+Shift+R
    // browser-reserved, +T/N browser-reserved, +Q macOS log-out).
    id: 'action-open-utility-pipelines',
    group: 'navigation',
    labelKey: 'shortcuts.item.utilityPipelines.label',
    combos: [{ tokens: ['Mod', 'Shift', 'G'] }],
    keywords: ['pipeline', 'chain', 'compose', 'recipe', 'utility', 'workflow'],
  },
  {
    // RL-100 Slice 1 fold A — Open the global Import overlay so the
    // user can paste a cURL command or drop a file from anywhere in
    // the app. Mod+Alt+I (I for Import). Verified free vs the
    // catalog — Mod+Shift+I is Variable Inspector (RL-020 Slice 9),
    // Mod+Shift+U is the test fixture's "free combo" reserve, the
    // other Shift+letter combos in the I/M/Q/R/T/Z range are
    // browser/macOS-reserved. Cmd+Alt+I is Chrome's "Inspect" but
    // Electron honors the app binding when the renderer has focus.
    id: 'action-open-import-overlay',
    group: 'overlays',
    labelKey: 'shortcuts.item.openImport.label',
    descriptionKey: 'shortcuts.item.openImport.description',
    combos: [{ tokens: ['Mod', 'Alt', 'I'] }],
    keywords: ['import', 'curl', 'paste', 'drop', 'bring in'],
  },
  {
    // RL-094 Slice 2 fold A — Open the Capsule Import overlay so the
    // user can paste / drop / pick a capsule JSON file and inspect
    // before opening as a new tab. `Mod+Shift+Y` (Y is unused +
    // visually mirrors the `Mod+Shift+X` export shortcut). Verified
    // free against the catalog by the conflict-free regression test
    // in `tests/data/keyboardShortcuts.test.ts`.
    id: 'overlay-capsule-import',
    group: 'navigation',
    labelKey: 'shortcuts.item.importCapsule.label',
    descriptionKey: 'shortcuts.item.importCapsule.description',
    combos: [{ tokens: ['Mod', 'Shift', 'Y'] }],
    keywords: [
      'capsule',
      'import',
      'open',
      'json',
      'paste',
      'replay',
      'cargar',
      'capsula',
      'cápsula',
    ],
  },
  {
    id: 'overlay-command-palette',
    group: 'overlays',
    labelKey: 'shortcuts.item.commandPalette.label',
    combos: [{ tokens: ['Mod', 'Shift', 'P'] }],
    keywords: ['command', 'palette'],
  },
  {
    id: 'overlay-settings',
    group: 'overlays',
    labelKey: 'shortcuts.item.settings.label',
    combos: [{ tokens: ['Mod', 'Comma'] }],
    keywords: ['settings', 'preferences'],
  },
  {
    id: 'overlay-developer-utilities',
    group: 'overlays',
    labelKey: 'shortcuts.item.developerUtilities.label',
    descriptionKey: 'shortcuts.item.developerUtilities.description',
    combos: [{ tokens: ['Mod', 'K'] }],
    keywords: ['developer', 'utilities', 'tools', 'devtools'],
  },
  {
    id: 'overlay-close',
    group: 'overlays',
    labelKey: 'shortcuts.item.closeOverlay.label',
    combos: [{ tokens: ['Escape'] }],
    keywords: ['escape', 'close', 'dismiss'],
  },
  {
    id: 'view-toggle-sidebar',
    group: 'view',
    labelKey: 'shortcuts.item.toggleSidebar.label',
    combos: [{ tokens: ['Mod', 'B'] }],
    keywords: ['sidebar', 'explorer', 'toggle'],
  },
  {
    id: 'view-toggle-console',
    group: 'view',
    labelKey: 'shortcuts.item.toggleConsole.label',
    combos: [{ tokens: ['Mod', 'Backslash'] }],
    keywords: ['console', 'output', 'toggle'],
  },
  // RL-069 Slice 1 — Developer Utilities productivity layer.
  // Both shortcuts no-op silently (toast `copyOutputEmpty`) when the
  // active utility panel has not registered an output provider yet.
  {
    id: 'utility-copy-output',
    group: 'utilities',
    labelKey: 'shortcuts.item.utilityCopyOutput.label',
    descriptionKey: 'shortcuts.item.utilityCopyOutput.description',
    combos: [{ tokens: ['Mod', 'Shift', 'C'] }],
    keywords: ['copy', 'output', 'clipboard', 'utility', 'utilities'],
  },
  {
    id: 'utility-replace-clipboard',
    group: 'utilities',
    labelKey: 'shortcuts.item.utilityReplaceClipboard.label',
    descriptionKey: 'shortcuts.item.utilityReplaceClipboard.description',
    combos: [{ tokens: ['Mod', 'Alt', 'R'] }],
    keywords: ['replace', 'clipboard', 'output', 'utility', 'utilities'],
  },
  // RL-069 Slice 2 — fires the ⚡ Apply-from-input button on the
  // focused utility panel. Default Mod+Shift+A keeps Mod+Enter free
  // for the editor's `run-toggle` shortcut.
  {
    id: 'utility-apply-from-input',
    group: 'utilities',
    labelKey: 'shortcuts.item.utilityApplyFromInput.label',
    descriptionKey: 'shortcuts.item.utilityApplyFromInput.description',
    combos: [{ tokens: ['Mod', 'Shift', 'A'] }],
    keywords: ['apply', 'detect', 'smart', 'paste', 'utility', 'utilities'],
  },
  // RL-027 Slice 1.5 fold C — keyboard-accessible breakpoint toggle.
  // Mod+B is already taken by `view-toggle-sidebar`; Mod+Shift+B is
  // free and reads close enough to VS Code's `F9` to feel familiar.
  // The handler is gated separately from the continue/step shortcuts
  // because it works whether or not a session is paused — see
  // `canDispatchDebuggerShortcut` in `useGlobalShortcuts`.
  {
    id: 'debugger-toggle-breakpoint',
    group: 'debugger',
    labelKey: 'shortcuts.item.debuggerToggleBreakpoint.label',
    descriptionKey: 'shortcuts.item.debuggerToggleBreakpoint.description',
    combos: [{ tokens: ['Mod', 'Shift', 'B'] }],
    keywords: ['debugger', 'breakpoint', 'toggle'],
  },
  // RL-027 Slice 1 — debugger continue / step shortcuts.
  {
    id: 'debugger-continue',
    group: 'debugger',
    labelKey: 'shortcuts.item.debuggerContinue.label',
    descriptionKey: 'shortcuts.item.debuggerContinue.description',
    combos: [{ tokens: ['F5'] }],
    keywords: ['debugger', 'continue', 'resume'],
  },
  {
    id: 'debugger-step-over',
    group: 'debugger',
    labelKey: 'shortcuts.item.debuggerStepOver.label',
    descriptionKey: 'shortcuts.item.debuggerStepOver.description',
    combos: [{ tokens: ['F10'] }],
    keywords: ['debugger', 'step', 'over'],
  },
  {
    id: 'debugger-step-into',
    group: 'debugger',
    labelKey: 'shortcuts.item.debuggerStepInto.label',
    descriptionKey: 'shortcuts.item.debuggerStepInto.description',
    combos: [{ tokens: ['F11'] }],
    keywords: ['debugger', 'step', 'into'],
  },
  {
    id: 'debugger-step-out',
    group: 'debugger',
    labelKey: 'shortcuts.item.debuggerStepOut.label',
    descriptionKey: 'shortcuts.item.debuggerStepOut.description',
    combos: [{ tokens: ['Shift', 'F11'] }],
    keywords: ['debugger', 'step', 'out'],
  },
];

/** Platform-aware label for the `Mod` token. Defaults to Ctrl on unknown shells. */
export function resolveShortcutDisplayPlatform(
  runtimePlatform: string,
  navigatorPlatform?: string
): ShortcutDisplayPlatform {
  if (runtimePlatform === 'darwin') {
    return 'darwin';
  }

  if (runtimePlatform === 'web') {
    const browserPlatform = navigatorPlatform?.toLowerCase() ?? '';
    if (browserPlatform.includes('mac')) {
      return 'darwin';
    }
  }

  return 'other';
}

export function resolveModLabel(platform: string): string {
  return platform === 'darwin' ? '⌘' : 'Ctrl';
}

const MAC_TOKEN_LABELS: Record<string, string> = {
  Shift: '⇧',
  Alt: '⌥',
  Enter: '↵',
  Escape: 'Esc',
  Backslash: '\\',
  Comma: ',',
};

const NON_MAC_TOKEN_LABELS: Record<string, string> = {
  Shift: 'Shift',
  Alt: 'Alt',
  Enter: 'Enter',
  Escape: 'Esc',
  Backslash: '\\',
  Comma: ',',
};

/**
 * Render a token as the string a user sees in the reference table. Unknown
 * single-character tokens are uppercased so catalog entries can declare
 * them in lowercase without affecting display. Word-form modifier labels
 * (Shift, Alt) on non-Mac platforms match OS-level conventions instead of
 * importing the macOS symbol glyphs.
 */
export function formatShortcutToken(token: ShortcutKeyToken, platform: string): string {
  const displayPlatform =
    platform === 'darwin' ? 'darwin' : 'other';
  if (token === 'Mod') return resolveModLabel(displayPlatform);
  const labels = displayPlatform === 'darwin' ? MAC_TOKEN_LABELS : NON_MAC_TOKEN_LABELS;
  const staticLabel = labels[token];
  if (staticLabel) return staticLabel;
  return token.length === 1 ? token.toUpperCase() : token;
}

export function formatShortcutCombo(combo: ShortcutCombo, platform: string): string {
  const separator = platform === 'darwin' ? '' : '+';
  return combo.tokens.map((token) => formatShortcutToken(token, platform)).join(separator);
}

/**
 * Override map keyed by shortcut id. Missing entries fall back to the
 * catalog's default combos. Exported as a readonly shape so the settings
 * store can hand it out without defensive cloning on every read.
 */
export type ShortcutOverrideMap = Readonly<Record<string, readonly ShortcutCombo[]>>;

/** Canonical string representation for combo equality + conflict lookups. */
export function comboKey(combo: ShortcutCombo): string {
  return combo.tokens.map((token) => (token.length === 1 ? token.toUpperCase() : token)).join('+');
}

const RESERVED_BROWSER_COMBO_KEYS = new Set([
  // Browser hard reload. Do not intercept or allow rebinding; users rely
  // on the native refresh behavior during web development.
  'Mod+Shift+R',
]);

export function isReservedShortcutCombo(combo: ShortcutCombo): boolean {
  return RESERVED_BROWSER_COMBO_KEYS.has(comboKey(combo));
}

/**
 * Editable shortcuts must keep at least one non-text modifier so the global
 * listener never steals ordinary typing from the editor or from overlay
 * search fields. `Escape` remains non-editable and is handled separately.
 */
export function isEditableShortcutCombo(combo: ShortcutCombo): boolean {
  if (isReservedShortcutCombo(combo)) return false;
  return combo.tokens.includes('Mod') || combo.tokens.includes('Alt');
}

function normalizeMainKey(rawKey: string): string | null {
  if (!rawKey) return null;
  if (rawKey === 'Enter') return 'Enter';
  if (rawKey === 'Escape' || rawKey === 'Esc') return 'Escape';
  if (rawKey === ' ' || rawKey === 'Space' || rawKey === 'Spacebar') return 'Space';
  if (rawKey === 'Tab') return 'Tab';
  if (rawKey === '\\') return 'Backslash';
  if (rawKey === ',') return 'Comma';
  if (rawKey === '.') return 'Period';
  if (rawKey === '/') return 'Slash';
  if (rawKey === ';') return 'Semicolon';
  if (rawKey === "'") return 'Quote';
  if (rawKey === '`') return 'Backtick';
  if (rawKey === '[') return 'BracketLeft';
  if (rawKey === ']') return 'BracketRight';
  if (rawKey === '-') return 'Minus';
  if (rawKey === '=') return 'Equal';
  if (rawKey === 'ArrowUp' || rawKey === 'ArrowDown' || rawKey === 'ArrowLeft' || rawKey === 'ArrowRight') {
    return rawKey;
  }
  if (/^F\d{1,2}$/.test(rawKey)) return rawKey;
  if (rawKey.length === 1) return rawKey.toUpperCase();
  return null;
}

const MODIFIER_KEYS = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'OS',
  'Hyper',
  'Super',
  'AltGraph',
  'CapsLock',
]);

/**
 * Normalize a keydown event into a ShortcutCombo matching the catalog's
 * token vocabulary. Returns null for modifier-only keydowns and for keys
 * that don't map cleanly — callers treat that as "still recording".
 */
export function keyboardEventToCombo(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>
): ShortcutCombo | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const mainKey = normalizeMainKey(event.key);
  if (!mainKey) return null;

  const tokens: ShortcutKeyToken[] = [];
  if (event.metaKey || event.ctrlKey) tokens.push('Mod');
  if (event.altKey) tokens.push('Alt');
  if (event.shiftKey) tokens.push('Shift');
  tokens.push(mainKey);
  return { tokens };
}

/** True when the keydown matches the combo's tokens exactly. */
export function matchesCombo(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  combo: ShortcutCombo
): boolean {
  const produced = keyboardEventToCombo(event);
  if (!produced) return false;
  if (isReservedShortcutCombo(produced)) return false;
  return comboKey(produced) === comboKey(combo);
}

/** Overrides (when non-empty) win over the catalog's defaults. */
export function resolveCombos(
  definition: ShortcutDefinition,
  overrides: ShortcutOverrideMap
): readonly ShortcutCombo[] {
  const override = overrides[definition.id];
  if (override && override.length > 0) return override;
  return definition.combos;
}

/**
 * Return the id of the shortcut that already owns `candidate`, or null if
 * no conflict exists. `selfId` is skipped so a user can rebind a shortcut
 * to one of its own existing combos without tripping the check.
 */
export function findComboConflict(
  catalog: readonly ShortcutDefinition[],
  overrides: ShortcutOverrideMap,
  candidate: ShortcutCombo,
  selfId: string
): string | null {
  const candidateKey = comboKey(candidate);
  for (const definition of catalog) {
    if (definition.id === selfId) continue;
    const combos = resolveCombos(definition, overrides);
    if (combos.some((combo) => comboKey(combo) === candidateKey)) {
      return definition.id;
    }
  }
  return null;
}

/** Case-insensitive match against label keywords and token labels. */
export function filterShortcuts(
  shortcuts: readonly ShortcutDefinition[],
  query: string,
  platform: string,
  translate: (key: string) => string
): ShortcutDefinition[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [...shortcuts];

  return shortcuts.filter((shortcut) => {
    const label = translate(shortcut.labelKey).toLowerCase();
    if (label.includes(trimmed)) return true;
    if (shortcut.keywords.some((keyword) => keyword.includes(trimmed))) return true;
    const combos = shortcut.combos
      .map((combo) => formatShortcutCombo(combo, platform))
      .join(' ')
      .toLowerCase();
    return combos.includes(trimmed);
  });
}
