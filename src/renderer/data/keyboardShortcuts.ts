/**
 * Startup-safe structural catalog for the shortcuts that
 * useGlobalShortcuts dispatches. Keep only ids, groups, and default combos
 * here because matching, override sanitization, and inline shortcut hints run
 * in the workspace graph. Localized reference copy and search keywords live
 * in keyboardShortcutReference.ts behind user-invoked Settings surfaces.
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
  combos: readonly ShortcutCombo[];
}

export type ShortcutDisplayPlatform = 'darwin' | 'other';

export const KEYBOARD_SHORTCUTS = [
  {
    id: 'run-toggle',
    group: 'run',
    combos: [{ tokens: ['Mod', 'Enter'] }],
  },
  {
    // implementation note — cycle through the implemented JS/TS
    // runtime modes on the active tab. implementation only has `worker`, so
    // the cycle is a no-op; implementation and implementation light up the same
    // shortcut as `node` and `browser-preview` come online.
    id: 'run-cycle-runtime-mode',
    group: 'run',
    combos: [{ tokens: ['Mod', 'Alt', 'M'] }],
  },
  {
    // implementation note — cycle the active tab's workflow mode
    // (Run → Debug → Scratchpad → Run) while skipping unsupported
    // segments for the language. Mirrors the `Mod+Shift+B`
    // breakpoint-toggle pattern from implementation
    id: 'run-cycle-workflow-mode',
    group: 'run',
    combos: [{ tokens: ['Mod', 'Shift', 'M'] }],
  },
  {
    // implementation note — toggle the per-tab Recent Runs popover.
    // No-op when no pill is mounted (Free tier, view-only tab, or
    // empty per-tab history). Dispatcher in `App.tsx` consults the
    // `recentRunsPopoverBridge` module.
    id: 'run-toggle-recent-runs',
    group: 'run',
    // implementation — moved from Mod+Shift+H to Mod+Alt+H so the
    // VSCode-parity `Mod+Shift+H` binding can map to project-replace
    // (`nav-project-replace`). Alt+H still reads as "History" mnemonic
    // for power users.
    combos: [{ tokens: ['Mod', 'Alt', 'H'] }],
  },
  {
    // implementation note — toggle the Compare panel on the active
    // tab. No-op when there's no comparator snapshot (matches the
    // toggle-button gate). Dispatcher in `App.tsx` reads + writes
    // `compareWithSnapshotEnabled` via the editor store.
    id: 'run-toggle-compare-snapshot',
    group: 'run',
    combos: [{ tokens: ['Mod', 'Shift', 'D'] }],
  },
  {
    // implementation note — toggle the Variables panel on the
    // active tab. No-op + notice when there's no scope snapshot.
    id: 'run-toggle-variable-inspector',
    group: 'run',
    combos: [{ tokens: ['Mod', 'Shift', 'I'] }],
  },
  // implementation — panel-chip shortcuts. Stdin chip mirrors the
  // Variables / Compare / History pattern with a single key combo
  // dedicated to the bottom-drawer chip.
  {
    id: 'editor-toggle-stdin-panel',
    group: 'run',
    combos: [{ tokens: ['Mod', 'Shift', 'E'] }],
  },
  // implementation note — keyboard shortcut for the primary
  // result-panel export surface. `Mod+Shift+X` (eXport mnemonic).
  // `Mod+Shift+E` is already taken by stdin toggle; X is the next
  // most semantic unused slot.
  {
    id: 'run-export-capsule',
    group: 'run',
    combos: [{ tokens: ['Mod', 'Shift', 'X'] }],
  },
  // implementation Phase A1 implementation note — keyboard shortcut for the share-link
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
    combos: [{ tokens: ['Mod', 'Shift', 'L'] }],
  },
  // implementation note — replay-onboarding shortcut. `Mod+Shift+W`
  // (W for Welcome). Verified free against the catalog by the
  // conflict-free regression test. Triggers all three reset setters
  // so the welcome scratchpad, first-run tip, and first-snippet tip
  // all re-arm on the next eligible event.
  {
    id: 'onboarding-replay',
    group: 'view',
    combos: [{ tokens: ['Mod', 'Shift', 'W'] }],
  },
  // implementation — recover from a floating-pill/variables-card that
  // ended up in an unreachable position (off-screen monitor change,
  // bad localStorage value). Clears both persisted positions back to
  // the synchronous defaults computed by the components.
  {
    id: 'ui-reset-floating-positions',
    group: 'view',
    combos: [{ tokens: ['Mod', 'Shift', '0'] }],
  },
  // implementation Slice A implementation note — open the bottom-panel Dependencies tab
  // for the active file. `Mod+Shift+J` (J for JavaScript / packaJes
  // mnemonic — the easy unused slot). Verified free against the
  // catalog by the conflict-free regression test in
  // `tests/data/keyboardShortcuts.test.ts`. No-op + status notice
  // when there are no detected dependencies (the tab is hidden) or
  // when the master toggle is OFF.
  {
    id: 'view-show-dependencies',
    group: 'view',
    combos: [{ tokens: ['Mod', 'Shift', 'J'] }],
  },
  {
    // implementation note — flip the variable inspector surface
    // (floating ↔ bottom). Distinct from `Mod+Shift+I` which toggles
    // the per-tab `variableInspectorEnabled` flag. Power-user shortcut
    // for moving Variables between surfaces without opening Settings.
    id: 'view-toggle-variable-inspector-surface',
    group: 'view',
    combos: [{ tokens: ['Mod', 'Shift', 'V'] }],
  },
  {
    id: 'file-save',
    group: 'file',
    combos: [{ tokens: ['Mod', 'S'] }],
  },
  {
    id: 'file-save-as',
    group: 'file',
    combos: [{ tokens: ['Mod', 'Shift', 'S'] }],
  },
  {
    id: 'file-open',
    group: 'file',
    combos: [{ tokens: ['Mod', 'O'] }],
  },
  {
    id: 'file-close-tab',
    group: 'file',
    combos: [{ tokens: ['Mod', 'W'] }],
  },
  {
    id: 'nav-quick-open',
    group: 'navigation',
    combos: [{ tokens: ['Mod', 'P'] }],
  },
  {
    id: 'nav-go-to-symbol',
    group: 'navigation',
    combos: [{ tokens: ['Mod', 'Shift', 'O'] }],
  },
  {
    id: 'nav-project-search',
    group: 'navigation',
    combos: [{ tokens: ['Mod', 'Shift', 'F'] }],
  },
  {
    // implementation — Replace in files. Cmd+Shift+H mirrors the
    // VSCode binding so users with that muscle memory can find it
    // immediately.
    id: 'nav-project-replace',
    group: 'navigation',
    combos: [{ tokens: ['Mod', 'Shift', 'H'] }],
  },
  {
    // implementation → MOV.02 — open or focus the full-screen HTTP
    // workspace tab. Mod+Shift+K is free in Lingua + not reserved by
    // browsers (Mod+Shift+R / +T / +N are all browser-reserved or
    // already taken). A second press focuses the tab; closing happens
    // through the editor tab strip.
    id: 'workspace-toggle-http',
    group: 'navigation',
    combos: [{ tokens: ['Mod', 'Shift', 'K'] }],
  },
  {
    // implementation → MOV.02 — open or focus the full-screen SQL
    // workspace tab. Mod+Alt+S (S for SQL) — verified free against the
    // catalog. Mod+Shift+Q rejected: macOS Cmd+Shift+Q is the OS-level
    // log-out shortcut and is intercepted by the system. Mod+Alt
    // namespace is less crowded (currently only +M / +H / +R are
    // claimed). A second press focuses the tab; closing happens through
    // the editor tab strip.
    id: 'workspace-toggle-sql',
    group: 'navigation',
    combos: [{ tokens: ['Mod', 'Alt', 'S'] }],
  },
  {
    // implementation note — Open the Developer Utilities workspace
    // with the Pipelines panel preselected. Mod+Shift+G (G for
    // Graph / pipeline; verified free vs the catalog — Mod+Shift+R
    // browser-reserved, +T/N browser-reserved, +Q macOS log-out).
    id: 'action-open-utility-pipelines',
    group: 'navigation',
    combos: [{ tokens: ['Mod', 'Shift', 'G'] }],
  },
  {
    // implementation note — Open the global Import overlay so the
    // user can paste a cURL command or drop a file from anywhere in
    // the app. Mod+Alt+I (I for Import). Verified free vs the
    // catalog — Mod+Shift+I is Variable Inspector ,
    // Mod+Shift+U is the test fixture's "free combo" reserve, the
    // other Shift+letter combos in the I/M/Q/R/T/Z range are
    // browser/macOS-reserved. Cmd+Alt+I is Chrome's "Inspect" but
    // Electron honors the app binding when the renderer has focus.
    id: 'action-open-import-overlay',
    group: 'overlays',
    combos: [{ tokens: ['Mod', 'Alt', 'I'] }],
  },
  {
    // implementation — export the open project as a `.zip` bundle.
    // Mod+Alt+E (E for Export); pairs with Mod+Alt+I (Import). Verified
    // free vs the catalog (the conflict-free regression test guards it).
    id: 'action-export-project-bundle',
    group: 'overlays',
    combos: [{ tokens: ['Mod', 'Alt', 'E'] }],
  },
  {
    // implementation Slice B implementation note — Open the global Recipes overlay so the
    // user can browse curated practice problems and load one into a
    // new tab. Mod+Alt+L (L for Lessons / Library). Verified free vs
    // the catalog — Mod+Shift+L is the internal share-link copy,
    // Mod+Alt+R is utility-replace-clipboard, Mod+Alt+I is the new
    // Import overlay, Mod+Alt+S is SQL workspace, Mod+Alt+H is the
    // recent-runs popover. Cmd+Alt+L is unused in Chrome and not a
    // macOS lockscreen combo (Ctrl+Cmd+Q owns lock).
    id: 'action-open-recipes',
    group: 'overlays',
    combos: [{ tokens: ['Mod', 'Alt', 'L'] }],
  },
  {
    // implementation Slice A implementation note — Create a fresh notebook tab from
    // anywhere via Mod+Alt+N (N for Notebook). Verified free vs the
    // catalog: Mod+Shift+N is browser "new window", Mod+Alt+L is
    // internal Recipes, Mod+Alt+I is internal import, Mod+Alt+S is SQL,
    // Mod+Alt+H is recent-runs. Browser/macOS: Cmd+Alt+N is unused
    // in Chrome; macOS lockscreen lives on Ctrl+Cmd+Q.
    id: 'action-new-notebook',
    group: 'navigation',
    combos: [{ tokens: ['Mod', 'Alt', 'N'] }],
  },
  {
    // implementation note — Open the Capsule Import overlay so the
    // user can paste / drop / pick a capsule JSON file and inspect
    // before opening as a new tab. `Mod+Shift+Y` (Y is unused +
    // visually mirrors the `Mod+Shift+X` export shortcut). Verified
    // free against the catalog by the conflict-free regression test
    // in `tests/data/keyboardShortcuts.test.ts`.
    id: 'overlay-capsule-import',
    group: 'navigation',
    combos: [{ tokens: ['Mod', 'Shift', 'Y'] }],
  },
  {
    // implementation — open the Pro-gated capsule browse overlay.
    // `Mod+Alt+C` (C = capsules) verified free against the catalog by
    // the conflict-free regression test in `keyboardShortcuts.test.ts`
    // (Mod+Shift+C is an OS/browser binding; Mod+Alt+C is free).
    id: 'overlay-capsule-list',
    group: 'navigation',
    combos: [{ tokens: ['Mod', 'Alt', 'C'] }],
  },
  {
    id: 'overlay-command-palette',
    group: 'overlays',
    combos: [{ tokens: ['Mod', 'Shift', 'P'] }],
  },
  {
    // internal — per-session stack of the last executed palette actions.
    id: 'overlay-recent-commands',
    group: 'overlays',
    combos: [{ tokens: ['Mod', 'Semicolon'] }],
  },
  {
    id: 'overlay-settings',
    group: 'overlays',
    combos: [{ tokens: ['Mod', 'Comma'] }],
  },
  {
    // MOV.03 — id kept stable for shortcut-overrides compatibility;
    // the binding now opens/focuses a full-screen Utilities workspace
    // tab instead of mounting a modal overlay.
    id: 'overlay-developer-utilities',
    group: 'utilities',
    combos: [{ tokens: ['Mod', 'K'] }],
  },
  {
    id: 'overlay-close',
    group: 'overlays',
    combos: [{ tokens: ['Escape'] }],
  },
  {
    id: 'view-toggle-sidebar',
    group: 'view',
    combos: [{ tokens: ['Mod', 'B'] }],
  },
  {
    // internal — presenter / focus mode: hide the chrome, lift the fonts.
    id: 'view-toggle-presenter',
    group: 'view',
    combos: [{ tokens: ['Mod', 'Alt', 'P'] }],
  },
  {
    id: 'view-toggle-console',
    group: 'view',
    combos: [{ tokens: ['Mod', 'Backslash'] }],
  },
  // implementation — Developer Utilities productivity layer.
  // Both shortcuts no-op silently (toast `copyOutputEmpty`) when the
  // active utility panel has not registered an output provider yet.
  {
    id: 'utility-copy-output',
    group: 'utilities',
    combos: [{ tokens: ['Mod', 'Shift', 'C'] }],
  },
  {
    id: 'utility-replace-clipboard',
    group: 'utilities',
    combos: [{ tokens: ['Mod', 'Alt', 'R'] }],
  },
  // implementation — fires the ⚡ Apply-from-input button on the
  // focused utility panel. Default Mod+Shift+A keeps Mod+Enter free
  // for the editor's `run-toggle` shortcut.
  {
    id: 'utility-apply-from-input',
    group: 'utilities',
    combos: [{ tokens: ['Mod', 'Shift', 'A'] }],
  },
  // implementation note — keyboard-accessible breakpoint toggle.
  // Mod+B is already taken by `view-toggle-sidebar`; Mod+Shift+B is
  // free and reads close enough to VS Code's `F9` to feel familiar.
  // The handler is gated separately from the continue/step shortcuts
  // because it works whether or not a session is paused — see
  // `canDispatchDebuggerShortcut` in `useGlobalShortcuts`.
  {
    id: 'debugger-toggle-breakpoint',
    group: 'debugger',
    combos: [{ tokens: ['Mod', 'Shift', 'B'] }],
  },
  // implementation — debugger continue / step shortcuts.
  {
    id: 'debugger-continue',
    group: 'debugger',
    combos: [{ tokens: ['F5'] }],
  },
  {
    id: 'debugger-step-over',
    group: 'debugger',
    combos: [{ tokens: ['F10'] }],
  },
  {
    id: 'debugger-step-into',
    group: 'debugger',
    combos: [{ tokens: ['F11'] }],
  },
  {
    id: 'debugger-step-out',
    group: 'debugger',
    combos: [{ tokens: ['Shift', 'F11'] }],
  },
] as const satisfies readonly ShortcutDefinition[];

export type ShortcutId = (typeof KEYBOARD_SHORTCUTS)[number]['id'];

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
  Semicolon: ';',
};

const NON_MAC_TOKEN_LABELS: Record<string, string> = {
  Shift: 'Shift',
  Alt: 'Alt',
  Enter: 'Enter',
  Escape: 'Esc',
  Backslash: '\\',
  Comma: ',',
  Semicolon: ';',
};

/**
 * Render a token as the string a user sees in the reference table. Unknown
 * single-character tokens are uppercased so catalog entries can declare
 * them in lowercase without affecting display. Word-form modifier labels
 * (Shift, Alt) on non-Mac platforms match OS-level conventions instead of
 * importing the macOS symbol glyphs.
 */
export function formatShortcutToken(token: ShortcutKeyToken, platform: string): string {
  const displayPlatform = platform === 'darwin' ? 'darwin' : 'other';
  if (token === 'Mod') return resolveModLabel(displayPlatform);
  const labels = displayPlatform === 'darwin' ? MAC_TOKEN_LABELS : NON_MAC_TOKEN_LABELS;
  const staticLabel = labels[token];
  if (staticLabel) return staticLabel;
  return token.length === 1 ? token.toUpperCase() : token;
}

export function formatShortcutCombo(combo: ShortcutCombo, platform: string): string {
  const separator = platform === 'darwin' ? '' : '+';
  return combo.tokens.map(token => formatShortcutToken(token, platform)).join(separator);
}

/**
 * Override map keyed by shortcut id. Missing entries fall back to the
 * catalog's default combos. Exported as a readonly shape so the settings
 * store can hand it out without defensive cloning on every read.
 */
export type ShortcutOverrideMap = Readonly<Record<string, readonly ShortcutCombo[]>>;

/** Canonical string representation for combo equality + conflict lookups. */
export function comboKey(combo: ShortcutCombo): string {
  return combo.tokens.map(token => (token.length === 1 ? token.toUpperCase() : token)).join('+');
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
  if (
    rawKey === 'ArrowUp' ||
    rawKey === 'ArrowDown' ||
    rawKey === 'ArrowLeft' ||
    rawKey === 'ArrowRight'
  ) {
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
    if (combos.some(combo => comboKey(combo) === candidateKey)) {
      return definition.id;
    }
  }
  return null;
}
