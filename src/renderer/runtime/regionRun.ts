import type { RunOptions } from '../hooks/useRunner';
import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { useRunRegionStore } from '../stores/runRegionStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { RunRegion } from '../utils/runRegions';
import { supportsRunRegions } from '../utils/runRegionLanguages';
import { getActiveEditor, getActiveEditorCursorLine } from './editorAccess';

/** Run options for one region of a tab, with the masked stdin answers kept for that tab. */
export function regionRunOptions(tabId: string, region: RunRegion): RunOptions {
  const tab = useEditorStore.getState().tabs.find(candidate => candidate.id === tabId);
  return { region, maskedStdin: useRunRegionStore.getState().maskedFor(tabId, tab?.stdinBuffer ?? '', tab?.content ?? '') };
}

/**
 * With Run regions on and the editor focused, the Run shortcut runs the region at the cursor.
 * Undefined right away when that cannot apply; otherwise the parser loads on demand, off the startup graph.
 */
export function regionRunAtCursor(): Promise<RunOptions | undefined> | undefined {
  if (useSettingsStore.getState().featureFlags.runRegions !== true) return undefined;
  if (!getActiveEditor()?.hasTextFocus()) return undefined;
  const tab = getActiveTab(useEditorStore.getState());
  const line = getActiveEditorCursorLine();
  if (!tab || line === null || !supportsRunRegions(tab.language) || !tab.content.includes('%%')) return undefined;
  const { id, content } = tab;
  const language = tab.language;
  return import('../utils/runRegions').then(({ parseRunRegions, runRegionAt }) => {
    const region = runRegionAt(parseRunRegions(content, language), line);
    return region ? regionRunOptions(id, region) : undefined;
  });
}
