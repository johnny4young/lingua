import { useMemo } from 'react';
import { formatShortcutLabel, type ShortcutId } from '../data/keyboardShortcuts';
import { useSettingsStore } from '../stores/settingsStore';

/** Platform-formatted primary combo for `id`, honoring user overrides; '' when unbound. */
export function useShortcutLabel(id: ShortcutId): string {
  const overrides = useSettingsStore(state => state.shortcutOverrides);
  return useMemo(() => formatShortcutLabel(id, overrides) ?? '', [id, overrides]);
}
