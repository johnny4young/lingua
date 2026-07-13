import {
  KEYBOARD_SHORTCUTS,
  matchesCombo,
  resolveCombos,
  type ShortcutDefinition,
  type ShortcutOverrideMap,
} from '../data/keyboardShortcuts';

const DISPATCHABLE_SHORTCUTS = KEYBOARD_SHORTCUTS.filter(entry => entry.id !== 'overlay-close');

/**
 * Find the first catalog entry matching a key event. The catalog owns combo
 * precedence, while debugger eligibility remains a runtime concern supplied by
 * the caller.
 */
export function findMatchingGlobalShortcut(
  event: KeyboardEvent,
  overrides: ShortcutOverrideMap,
  canDispatchDebuggerShortcut: (id: string) => boolean,
  hasAction: (id: string) => boolean = () => true
): ShortcutDefinition | null {
  for (const definition of DISPATCHABLE_SHORTCUTS) {
    const combos = resolveCombos(definition, overrides);
    if (!combos.some(combo => matchesCombo(event, combo))) continue;
    if (definition.group === 'debugger' && !canDispatchDebuggerShortcut(definition.id)) {
      continue;
    }
    if (!hasAction(definition.id)) continue;
    return definition;
  }
  return null;
}
