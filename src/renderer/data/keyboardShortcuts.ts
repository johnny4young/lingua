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

export type ShortcutGroupId = 'run' | 'file' | 'navigation' | 'overlays' | 'view';

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
