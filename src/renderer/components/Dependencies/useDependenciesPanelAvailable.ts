import { useDependencyDetectionStore } from '../../stores/dependencyDetectionStore';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';

export function useDependenciesPanelAvailable(): boolean {
  const enabled = useSettingsStore((s) => s.dependencyDetectionEnabled);
  // Primitive selectors: the shell reads this hook, so a keystroke must not re-render it.
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const activeLanguage = useEditorStore((s) => getActiveTab(s)?.language);
  return useDependencyDetectionStore((s) => {
    if (!enabled || !activeTabId) return false;
    const entry = s.byTab.get(activeTabId);
    if (!entry || entry.language !== activeLanguage) return false;
    return entry.dependencies.length > 0 || entry.skippedReason !== undefined;
  });
}
