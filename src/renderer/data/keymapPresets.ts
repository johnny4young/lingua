import type { ShortcutOverrideMap } from './keyboardShortcuts';

/**
 * A keymap preset is a named bundle of `shortcutOverrides` that users can
 * apply in one click. Picking a preset REPLACES any prior per-shortcut
 * overrides — this is intentional so the preset's identity stays honest
 * (users can always fall back to `default`, which clears overrides).
 *
 * Keep this list short and curated. New presets belong here only if they
 * meaningfully differ from `default`; cosmetic swaps make the UI noisy
 * without helping users.
 */
export interface KeymapPreset {
  id: string;
  labelKey: string;
  descriptionKey: string;
  overrides: ShortcutOverrideMap;
}

export const DEFAULT_KEYMAP_PRESET_ID = 'default';

export const KEYMAP_PRESETS: readonly KeymapPreset[] = [
  {
    id: DEFAULT_KEYMAP_PRESET_ID,
    labelKey: 'shortcuts.preset.default.label',
    descriptionKey: 'shortcuts.preset.default.description',
    overrides: {},
  },
  {
    id: 'sublime',
    labelKey: 'shortcuts.preset.sublime.label',
    descriptionKey: 'shortcuts.preset.sublime.description',
    overrides: {
      // Sublime Text famously binds "Go to Symbol" to Mod+R, not Mod+Shift+O.
      'nav-go-to-symbol': [{ tokens: ['Mod', 'R'] }],
      // Sublime uses Mod+Backtick for the panel toggle — we reuse it for the
      // console panel so the muscle memory carries over.
      'view-toggle-console': [{ tokens: ['Mod', 'Backtick'] }],
    },
  },
  {
    id: 'classic-ide',
    labelKey: 'shortcuts.preset.classicIde.label',
    descriptionKey: 'shortcuts.preset.classicIde.description',
    overrides: {
      // Classic IDE flows tend to put Go to Symbol on Alt+Shift+O and the
      // full project search on Alt+Shift+F (Visual Studio, Eclipse, WebStorm
      // under the IntelliJ-classic keymap). The `Mod` token still resolves
      // to Ctrl/Cmd per platform — we only swap the auxiliary modifier.
      'nav-go-to-symbol': [{ tokens: ['Mod', 'Alt', 'O'] }],
      'nav-project-search': [{ tokens: ['Mod', 'Alt', 'F'] }],
      // Terminal-style console toggle on Mod+J mirrors JetBrains/WebStorm.
      'view-toggle-console': [{ tokens: ['Mod', 'J'] }],
    },
  },
];

export function findKeymapPreset(id: string): KeymapPreset | undefined {
  return KEYMAP_PRESETS.find((preset) => preset.id === id);
}

export function isKnownKeymapPresetId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  return KEYMAP_PRESETS.some((preset) => preset.id === id);
}
