import { useEffect, useEffectEvent } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import {
  buildGlobalShortcutActions,
  canDispatchDebuggerShortcut,
} from './globalShortcutActions';
import { findMatchingGlobalShortcut } from './globalShortcutModel';
import type { UseGlobalShortcutsOptions } from './globalShortcutTypes';

export type { AppOverlay, UseGlobalShortcutsOptions } from './globalShortcutTypes';

/** Register the single window listener that dispatches the shortcut catalog. */
export function useGlobalShortcuts(options: UseGlobalShortcutsOptions) {
  const overrides = useSettingsStore(state => state.shortcutOverrides);

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // Escape only belongs to the app while an overlay is open.
    if (event.key === 'Escape') {
      if (options.overlay !== 'none') {
        event.preventDefault();
        options.closeOverlay();
      }
      return;
    }

    const actions = buildGlobalShortcutActions(options);
    const definition = findMatchingGlobalShortcut(
      event,
      overrides,
      canDispatchDebuggerShortcut,
      id => Boolean(actions[id])
    );
    if (!definition) return;

    const action = actions[definition.id];
    if (!action) return;
    event.preventDefault();
    action(event);
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKeyDown(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}
