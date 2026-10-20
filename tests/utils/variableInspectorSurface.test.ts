import { beforeEach, describe, expect, it } from 'vitest';
import {
  nextVariableInspectorEnabled,
  syncVariableInspectorSurfaceAfterToggle,
} from '../../src/renderer/utils/variableInspectorSurface';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';

describe('syncVariableInspectorSurfaceAfterToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ variableInspectorSurface: 'floating' }, false);
    useUIStore.setState({
      activeBottomPanel: 'console',
      consoleVisible: false,
    });
  });

  it('does not move the bottom drawer while the floating surface is selected', () => {
    syncVariableInspectorSurfaceAfterToggle(true);

    expect(useUIStore.getState()).toMatchObject({
      activeBottomPanel: 'console',
      consoleVisible: false,
    });
  });

  it('opens the Variables drawer when bottom mode is enabled', () => {
    useSettingsStore.setState({ variableInspectorSurface: 'bottom' }, false);

    syncVariableInspectorSurfaceAfterToggle(true);

    expect(useUIStore.getState()).toMatchObject({
      activeBottomPanel: 'variables',
      consoleVisible: true,
    });
  });

  it('returns the dock to Console when Variables turns off', () => {
    useSettingsStore.setState({ variableInspectorSurface: 'bottom' }, false);
    useUIStore.setState({
      activeBottomPanel: 'variables',
      consoleVisible: true,
    });

    syncVariableInspectorSurfaceAfterToggle(false);

    expect(useUIStore.getState()).toMatchObject({
      activeBottomPanel: 'console',
      consoleVisible: true,
    });
  });

  it('follows the dock tab in dock mode and the tab flag for the floating card', () => {
    expect(nextVariableInspectorEnabled(true)).toBe(false);
    useSettingsStore.setState({ variableInspectorSurface: 'bottom' }, false);
    // A stale per-tab flag no longer decides: the dock is not showing Variables.
    expect(nextVariableInspectorEnabled(true)).toBe(true);
    useUIStore.setState({ activeBottomPanel: 'variables', consoleVisible: true });
    expect(nextVariableInspectorEnabled(false)).toBe(false);
  });
});
