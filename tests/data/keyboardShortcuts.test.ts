import { describe, expect, it } from 'vitest';
import {
  KEYBOARD_SHORTCUTS,
  SHORTCUT_GROUPS,
  comboKey,
  filterShortcuts,
  findComboConflict,
  formatShortcutCombo,
  formatShortcutToken,
  isEditableShortcutCombo,
  isReservedShortcutCombo,
  keyboardEventToCombo,
  matchesCombo,
  resolveCombos,
  resolveShortcutDisplayPlatform,
  resolveModLabel,
} from '@/data/keyboardShortcuts';

const identity = (key: string) => key;

describe('keyboardShortcuts catalog', () => {
  it('groups every shortcut under a declared group', () => {
    const groupIds = new Set(SHORTCUT_GROUPS.map((group) => group.id));
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      expect(groupIds.has(shortcut.group)).toBe(true);
    }
  });

  it('keeps shortcut ids unique so list keys stay stable', () => {
    const ids = KEYBOARD_SHORTCUTS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps catalog defaults dispatchable by avoiding browser-reserved combos', () => {
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      for (const combo of shortcut.combos) {
        expect(
          isReservedShortcutCombo(combo),
          `${shortcut.id} declares reserved combo ${comboKey(combo)}`
        ).toBe(false);
      }
    }
  });

  // Reviewer pass on RL-036 Phase A1 caught a silent
  // `run-copy-share-link` ↔ `overlay-command-palette` collision on
  // `Mod+Shift+P` (the share entry won because it was declared earlier
  // in the catalog and useGlobalShortcuts iterates first-match-wins).
  // This guard fails fast on any future regression by walking every
  // (shortcut, combo) pair and asserting each comboKey appears at most
  // once across the catalog. The `excluded` set carries an explicit
  // ALLOW-LIST for combos that intentionally re-use the same key
  // (none today; documented inline if future product design needs
  // overlay+navigation sharing a combo).
  it('contains no internal combo conflicts (every combo binds to at most one id)', () => {
    const byCombo = new Map<string, string[]>();
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      for (const combo of shortcut.combos) {
        const key = comboKey(combo);
        const owners = byCombo.get(key) ?? [];
        owners.push(shortcut.id);
        byCombo.set(key, owners);
      }
    }
    const collisions = Array.from(byCombo.entries()).filter(
      ([, owners]) => owners.length > 1
    );
    expect(
      collisions,
      `Internal combo conflicts: ${collisions
        .map(([key, owners]) => `${key} → [${owners.join(', ')}]`)
        .join('; ')}`
    ).toEqual([]);
  });

  it('covers the high-traffic shortcuts dispatched by useGlobalShortcuts', () => {
    const ids = new Set(KEYBOARD_SHORTCUTS.map((entry) => entry.id));
    for (const required of [
      'run-toggle',
      'run-cycle-runtime-mode',
      'run-cycle-workflow-mode',
      'run-toggle-recent-runs',
      'run-export-capsule',
      'onboarding-replay',
      'file-save',
      'file-save-as',
      'file-open',
      'file-close-tab',
      'nav-quick-open',
      'nav-go-to-symbol',
      'nav-project-search',
      // RL-094 Slice 3 — capsule browse overlay shortcut.
      'overlay-capsule-list',
      'overlay-command-palette',
      'overlay-settings',
      'overlay-developer-utilities',
      'overlay-close',
      'view-toggle-sidebar',
      'view-toggle-console',
      // RL-069 Slice 1 — Developer Utilities productivity shortcuts.
      'utility-copy-output',
      'utility-replace-clipboard',
      // RL-069 Slice 2 — Apply-from-input shortcut.
      'utility-apply-from-input',
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });

  it('declares the runtime-mode cycle shortcut as Mod+Alt+M', () => {
    const shortcut = KEYBOARD_SHORTCUTS.find(
      (entry) => entry.id === 'run-cycle-runtime-mode'
    );
    expect(shortcut).toBeDefined();
    expect(shortcut?.group).toBe('run');
    expect(shortcut?.combos).toEqual([{ tokens: ['Mod', 'Alt', 'M'] }]);
  });

  it('declares the Recent Runs popover shortcut as Mod+Alt+H', () => {
    // RL-024 Slice 2 — moved from Mod+Shift+H to Mod+Alt+H so the
    // VSCode-parity `Mod+Shift+H` binding goes to project-replace.
    const shortcut = KEYBOARD_SHORTCUTS.find(
      (entry) => entry.id === 'run-toggle-recent-runs'
    );
    expect(shortcut).toBeDefined();
    expect(shortcut?.group).toBe('run');
    expect(shortcut?.combos).toEqual([{ tokens: ['Mod', 'Alt', 'H'] }]);
  });

  it('declares the capsule browse shortcut as Mod+Alt+C (RL-094 Slice 3)', () => {
    const shortcut = KEYBOARD_SHORTCUTS.find(
      (entry) => entry.id === 'overlay-capsule-list'
    );
    expect(shortcut).toBeDefined();
    expect(shortcut?.group).toBe('navigation');
    expect(shortcut?.combos).toEqual([{ tokens: ['Mod', 'Alt', 'C'] }]);
  });

  it('declares the project-replace shortcut as Mod+Shift+H', () => {
    const shortcut = KEYBOARD_SHORTCUTS.find(
      (entry) => entry.id === 'nav-project-replace'
    );
    expect(shortcut).toBeDefined();
    expect(shortcut?.group).toBe('navigation');
    expect(shortcut?.combos).toEqual([{ tokens: ['Mod', 'Shift', 'H'] }]);
  });

  it('declares the Developer Utilities launcher shortcut as Mod+K', () => {
    const shortcut = KEYBOARD_SHORTCUTS.find(
      (entry) => entry.id === 'overlay-developer-utilities'
    );
    expect(shortcut).toBeDefined();
    expect(shortcut?.combos).toEqual([{ tokens: ['Mod', 'K'] }]);
    expect(shortcut?.group).toBe('overlays');
  });

  it('declares the onboarding replay shortcut as Mod+Shift+W', () => {
    const shortcut = KEYBOARD_SHORTCUTS.find(
      (entry) => entry.id === 'onboarding-replay'
    );
    expect(shortcut).toBeDefined();
    expect(shortcut?.group).toBe('view');
    expect(shortcut?.combos).toEqual([{ tokens: ['Mod', 'Shift', 'W'] }]);
  });

  it('declares a utilities group with all three RL-069 productivity shortcuts', () => {
    const groupIds = new Set(SHORTCUT_GROUPS.map((group) => group.id));
    expect(groupIds.has('utilities')).toBe(true);

    const utilityShortcuts = KEYBOARD_SHORTCUTS.filter(
      (entry) => entry.group === 'utilities'
    );
    expect(utilityShortcuts.map((entry) => entry.id).sort()).toEqual([
      'utility-apply-from-input',
      'utility-copy-output',
      'utility-replace-clipboard',
    ]);

    // The defaults stay editable (Mod-bearing) so they can travel
    // through the keyboard shortcut editor without tripping the
    // isEditableShortcutCombo guard.
    for (const shortcut of utilityShortcuts) {
      for (const combo of shortcut.combos) {
        expect(combo.tokens).toContain('Mod');
      }
    }

    expect(
      KEYBOARD_SHORTCUTS.find((entry) => entry.id === 'utility-copy-output')?.combos
    ).toEqual([{ tokens: ['Mod', 'Shift', 'C'] }]);
    expect(
      KEYBOARD_SHORTCUTS.find((entry) => entry.id === 'utility-replace-clipboard')?.combos
    ).toEqual([{ tokens: ['Mod', 'Alt', 'R'] }]);
    // RL-069 Slice 2 — Mod+Shift+A keeps Mod+Enter free for the
    // editor's run-toggle shortcut.
    expect(
      KEYBOARD_SHORTCUTS.find((entry) => entry.id === 'utility-apply-from-input')?.combos
    ).toEqual([{ tokens: ['Mod', 'Shift', 'A'] }]);
  });

  it('declares a debugger group with the Slice 1 control shortcuts and the Slice 1.5 toggle', () => {
    const groupIds = new Set(SHORTCUT_GROUPS.map((group) => group.id));
    expect(groupIds.has('debugger')).toBe(true);

    const debuggerShortcuts = KEYBOARD_SHORTCUTS.filter(
      (entry) => entry.group === 'debugger'
    );
    expect(debuggerShortcuts.map((entry) => entry.id).sort()).toEqual([
      'debugger-continue',
      'debugger-step-into',
      'debugger-step-out',
      'debugger-step-over',
      // RL-027 Slice 1.5 fold C — keyboard-accessible breakpoint toggle.
      'debugger-toggle-breakpoint',
    ]);

    // Function-key combos mirror VS Code defaults exactly so muscle
    // memory carries over.
    expect(
      KEYBOARD_SHORTCUTS.find((entry) => entry.id === 'debugger-continue')?.combos
    ).toEqual([{ tokens: ['F5'] }]);
    expect(
      KEYBOARD_SHORTCUTS.find((entry) => entry.id === 'debugger-step-over')?.combos
    ).toEqual([{ tokens: ['F10'] }]);
    expect(
      KEYBOARD_SHORTCUTS.find((entry) => entry.id === 'debugger-step-into')?.combos
    ).toEqual([{ tokens: ['F11'] }]);
    expect(
      KEYBOARD_SHORTCUTS.find((entry) => entry.id === 'debugger-step-out')?.combos
    ).toEqual([{ tokens: ['Shift', 'F11'] }]);
    // Slice 1.5 fold C — Mod+B is taken by `view-toggle-sidebar`, so the
    // breakpoint toggle ships with Mod+Shift+B.
    expect(
      KEYBOARD_SHORTCUTS.find((entry) => entry.id === 'debugger-toggle-breakpoint')?.combos
    ).toEqual([{ tokens: ['Mod', 'Shift', 'B'] }]);
  });
});

describe('formatShortcutToken', () => {
  it('detects mac display combos for desktop darwin and browser Mac platforms', () => {
    expect(resolveShortcutDisplayPlatform('darwin')).toBe('darwin');
    expect(resolveShortcutDisplayPlatform('web', 'MacIntel')).toBe('darwin');
    expect(resolveShortcutDisplayPlatform('web', 'Win32')).toBe('other');
    expect(resolveShortcutDisplayPlatform('linux')).toBe('other');
  });

  it('maps the Mod token to the cmd glyph on macOS and Ctrl elsewhere', () => {
    expect(resolveModLabel('darwin')).toBe('⌘');
    expect(resolveModLabel('other')).toBe('Ctrl');
  });

  it('renders named special tokens with symbols on macOS', () => {
    expect(formatShortcutToken('Shift', 'darwin')).toBe('⇧');
    expect(formatShortcutToken('Alt', 'darwin')).toBe('⌥');
    expect(formatShortcutToken('Enter', 'darwin')).toBe('↵');
  });

  it('renders word-form modifier names on non-Mac platforms', () => {
    expect(formatShortcutToken('Shift', 'linux')).toBe('Shift');
    expect(formatShortcutToken('Alt', 'win32')).toBe('Alt');
    expect(formatShortcutToken('Escape', 'linux')).toBe('Esc');
    expect(formatShortcutToken('Backslash', 'linux')).toBe('\\');
    expect(formatShortcutToken('Comma', 'linux')).toBe(',');
  });

  it('uppercases single-character tokens so lowercase catalog entries render cleanly', () => {
    expect(formatShortcutToken('s', 'linux')).toBe('S');
  });

  it('passes multi-character unknown tokens through unchanged', () => {
    expect(formatShortcutToken('F5', 'linux')).toBe('F5');
  });
});

describe('formatShortcutCombo', () => {
  it('concatenates tokens without a separator on macOS (matches system HIG)', () => {
    expect(formatShortcutCombo({ tokens: ['Mod', 'Shift', 'P'] }, 'darwin')).toBe('⌘⇧P');
  });

  it('uses + separators on non-mac platforms', () => {
    expect(formatShortcutCombo({ tokens: ['Mod', 'Shift', 'P'] }, 'linux')).toBe('Ctrl+Shift+P');
  });
});

describe('filterShortcuts', () => {
  it('returns a copy of the catalog when the query is blank', () => {
    const result = filterShortcuts(KEYBOARD_SHORTCUTS, '   ', 'linux', identity);
    expect(result).toHaveLength(KEYBOARD_SHORTCUTS.length);
    expect(result).not.toBe(KEYBOARD_SHORTCUTS);
  });

  it('matches against the translated label', () => {
    const result = filterShortcuts(
      KEYBOARD_SHORTCUTS,
      'save',
      'linux',
      (key) => (key.endsWith('save.label') ? 'Save' : key)
    );
    expect(result.some((entry) => entry.id === 'file-save')).toBe(true);
  });

  it('matches against keywords', () => {
    const result = filterShortcuts(KEYBOARD_SHORTCUTS, 'hotkey', 'linux', identity);
    // No keyword is literally "hotkey", so this should be empty
    expect(result).toHaveLength(0);
    const keyworded = filterShortcuts(KEYBOARD_SHORTCUTS, 'fuzzy', 'linux', identity);
    expect(keyworded.some((entry) => entry.id === 'nav-quick-open')).toBe(true);
  });

  it('matches against rendered combo text so users can search by keystroke', () => {
    const result = filterShortcuts(KEYBOARD_SHORTCUTS, 'ctrl+b', 'linux', identity);
    expect(result.some((entry) => entry.id === 'view-toggle-sidebar')).toBe(true);

    const macResult = filterShortcuts(KEYBOARD_SHORTCUTS, '⌘B', 'darwin', identity);
    expect(macResult.some((entry) => entry.id === 'view-toggle-sidebar')).toBe(true);
  });
});

function keyEvent(init: Partial<KeyboardEvent> & { key: string }) {
  return {
    key: init.key,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
  } as KeyboardEvent;
}

describe('keyboardEventToCombo', () => {
  it('maps Cmd+Shift+S to Mod+Shift+S', () => {
    const combo = keyboardEventToCombo(keyEvent({ key: 's', metaKey: true, shiftKey: true }));
    expect(combo?.tokens).toEqual(['Mod', 'Shift', 'S']);
  });

  it('collapses Cmd and Ctrl into the Mod token', () => {
    const mac = keyboardEventToCombo(keyEvent({ key: 'p', metaKey: true }));
    const linux = keyboardEventToCombo(keyEvent({ key: 'p', ctrlKey: true }));
    expect(mac?.tokens).toEqual(linux?.tokens);
  });

  it('normalizes named keys to catalog tokens', () => {
    expect(keyboardEventToCombo(keyEvent({ key: 'Enter' }))?.tokens).toEqual(['Enter']);
    expect(keyboardEventToCombo(keyEvent({ key: 'Escape' }))?.tokens).toEqual(['Escape']);
    expect(keyboardEventToCombo(keyEvent({ key: '\\', ctrlKey: true }))?.tokens).toEqual([
      'Mod',
      'Backslash',
    ]);
    expect(keyboardEventToCombo(keyEvent({ key: ',', metaKey: true }))?.tokens).toEqual([
      'Mod',
      'Comma',
    ]);
  });

  it('returns null for pure modifier keydowns', () => {
    expect(keyboardEventToCombo(keyEvent({ key: 'Shift', shiftKey: true }))).toBeNull();
    expect(keyboardEventToCombo(keyEvent({ key: 'Control', ctrlKey: true }))).toBeNull();
    expect(keyboardEventToCombo(keyEvent({ key: 'Meta', metaKey: true }))).toBeNull();
  });
});

describe('matchesCombo', () => {
  it('returns true when the event produces the same canonical combo', () => {
    expect(
      matchesCombo(keyEvent({ key: 'b', metaKey: true }), { tokens: ['Mod', 'B'] })
    ).toBe(true);
  });

  it('returns false when modifiers or key differ', () => {
    expect(matchesCombo(keyEvent({ key: 'b' }), { tokens: ['Mod', 'B'] })).toBe(false);
    expect(
      matchesCombo(keyEvent({ key: 'b', metaKey: true, shiftKey: true }), {
        tokens: ['Mod', 'B'],
      })
    ).toBe(false);
  });

  it('never matches the browser hard-refresh combo', () => {
    expect(
      matchesCombo(keyEvent({ key: 'r', metaKey: true, shiftKey: true }), {
        tokens: ['Mod', 'Shift', 'R'],
      })
    ).toBe(false);
  });
});

describe('resolveCombos', () => {
  const definition = KEYBOARD_SHORTCUTS.find((entry) => entry.id === 'view-toggle-sidebar')!;

  it('falls back to the catalog when no override is present', () => {
    expect(resolveCombos(definition, {})).toEqual(definition.combos);
  });

  it('uses the override when present and non-empty', () => {
    const overrides = {
      'view-toggle-sidebar': [{ tokens: ['Mod', 'Shift', 'B'] }],
    };
    expect(resolveCombos(definition, overrides)[0].tokens).toEqual(['Mod', 'Shift', 'B']);
  });

  it('falls back when the override is an empty array', () => {
    expect(resolveCombos(definition, { 'view-toggle-sidebar': [] })).toEqual(definition.combos);
  });
});

describe('findComboConflict', () => {
  it('detects a conflict with another catalog default', () => {
    const id = findComboConflict(
      KEYBOARD_SHORTCUTS,
      {},
      { tokens: ['Mod', 'S'] },
      'view-toggle-sidebar'
    );
    expect(id).toBe('file-save');
  });

  it('skips the shortcut being edited so self-reassignment is fine', () => {
    const id = findComboConflict(
      KEYBOARD_SHORTCUTS,
      {},
      { tokens: ['Mod', 'B'] },
      'view-toggle-sidebar'
    );
    expect(id).toBeNull();
  });

  it('honors overrides when resolving the conflict map', () => {
    const overrides = {
      'file-save': [{ tokens: ['Mod', 'Alt', 'S'] }],
    };
    // file-save's default (Mod+S) is now free
    const id = findComboConflict(
      KEYBOARD_SHORTCUTS,
      overrides,
      { tokens: ['Mod', 'S'] },
      'view-toggle-sidebar'
    );
    expect(id).toBeNull();
  });
});

describe('comboKey', () => {
  it('produces a stable string independent of casing', () => {
    expect(comboKey({ tokens: ['Mod', 'S'] })).toBe(comboKey({ tokens: ['Mod', 's'] }));
  });
});

describe('isEditableShortcutCombo', () => {
  it('accepts combos that keep a non-text modifier', () => {
    expect(isEditableShortcutCombo({ tokens: ['Mod', 'S'] })).toBe(true);
    expect(isEditableShortcutCombo({ tokens: ['Alt', 'Enter'] })).toBe(true);
  });

  it('rejects browser-reserved hard-refresh combos', () => {
    expect(isReservedShortcutCombo({ tokens: ['Mod', 'Shift', 'R'] })).toBe(true);
    expect(isEditableShortcutCombo({ tokens: ['Mod', 'Shift', 'R'] })).toBe(false);
    expect(isReservedShortcutCombo({ tokens: ['Mod', 'Alt', 'R'] })).toBe(false);
    expect(isEditableShortcutCombo({ tokens: ['Mod', 'Alt', 'R'] })).toBe(true);
  });

  it('rejects plain keys and shift-only combos so typing is not stolen globally', () => {
    expect(isEditableShortcutCombo({ tokens: ['J'] })).toBe(false);
    expect(isEditableShortcutCombo({ tokens: ['Shift', 'J'] })).toBe(false);
  });
});
