import type { RunOptions } from '../hooks/useRunner';
import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { useRunRegionStore } from '../stores/runRegionStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { RunRegion } from '../utils/runRegions';
import { getActiveEditor, getActiveEditorCursorLine } from './editorAccess';

const REGION_LANGUAGES = new Set(['javascript', 'typescript', 'python']);

/** Run options for one region of a tab, with the masked stdin answers kept for that tab. */
export function regionRunOptions(tabId: string, region: RunRegion): RunOptions {
  return { region, maskedStdin: useRunRegionStore.getState().masked[tabId] ?? [] };
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
  if (!tab || line === null || !REGION_LANGUAGES.has(tab.language) || !tab.content.includes('%%')) return undefined;
  const { id, content, language } = tab;
  return import('../utils/runRegions').then(({ parseRunRegions, runRegionAt }) => {
    const region = runRegionAt(parseRunRegions(content, language as 'javascript' | 'typescript' | 'python'), line);
    return region ? regionRunOptions(id, region) : undefined;
  });
}
