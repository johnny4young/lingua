import { useMemo } from 'react';
import { formatShortcutLabel, type ShortcutId } from '../data/keyboardShortcuts';
import { useSettingsStore } from '../stores/settingsStore';

/** Platform-formatted primary combo for `id`, honoring user overrides; '' when unbound or no id. */
export function useShortcutLabel(id: ShortcutId | undefined): string {
  const overrides = useSettingsStore(state => state.shortcutOverrides);
  return useMemo(() => (id ? (formatShortcutLabel(id, overrides) ?? '') : ''), [id, overrides]);
}
