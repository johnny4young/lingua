import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';

/**
 * The next Variables state for a toggle. In the dock it follows the dock tab,
 * like Compare; the floating card follows the per-tab flag.
 */
export function nextVariableInspectorEnabled(tabFlag: boolean): boolean {
  if (useSettingsStore.getState().variableInspectorSurface !== 'bottom') return !tabFlag;
  const ui = useUIStore.getState();
  return !(ui.consoleVisible && ui.activeBottomPanel === 'variables');
}

/**
 * Keep every user-driven Variables toggle honest when the user picked the
 * dock surface: on opens the Variables tab, off returns the dock to Console.
 */
export function syncVariableInspectorSurfaceAfterToggle(enabled: boolean): void {
  if (useSettingsStore.getState().variableInspectorSurface !== 'bottom') {
    return;
  }

  const uiState = useUIStore.getState();
  if (enabled) {
    uiState.openBottomPanel('variables');
    return;
  }

  if (uiState.activeBottomPanel === 'variables') {
    uiState.openBottomPanel('console');
  }
}
