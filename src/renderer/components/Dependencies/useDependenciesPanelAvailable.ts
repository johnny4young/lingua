import { useDependencyDetectionStore } from '../../stores/dependencyDetectionStore';
import { useEditorStore } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';

export function useDependenciesPanelAvailable(): boolean {
  const enabled = useSettingsStore((s) => s.dependencyDetectionEnabled);
  const activeTab = useEditorStore((s) =>
    s.activeTabId
      ? s.tabs.find((tab) => tab.id === s.activeTabId) ?? null
      : null
  );
  return useDependencyDetectionStore((s) => {
    if (!enabled || !activeTab) return false;
    const entry = s.byTab.get(activeTab.id);
    if (!entry || entry.language !== activeTab.language) return false;
    return entry.dependencies.length > 0 || entry.skippedReason !== undefined;
  });
}
