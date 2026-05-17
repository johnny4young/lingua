import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';

/**
 * Keep every user-driven Variables toggle honest when the user picked the
 * bottom-panel surface. The per-tab flag still owns whether Variables is on;
 * this helper only makes the chosen surface visible or hides it again.
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
    uiState.setConsoleVisible(false);
  }
}
