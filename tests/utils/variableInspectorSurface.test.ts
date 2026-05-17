import { beforeEach, describe, expect, it } from 'vitest';
import { syncVariableInspectorSurfaceAfterToggle } from '../../src/renderer/utils/variableInspectorSurface';
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

  it('closes the Variables drawer when bottom mode is disabled', () => {
    useSettingsStore.setState({ variableInspectorSurface: 'bottom' }, false);
    useUIStore.setState({
      activeBottomPanel: 'variables',
      consoleVisible: true,
    });

    syncVariableInspectorSurfaceAfterToggle(false);

    expect(useUIStore.getState()).toMatchObject({
      activeBottomPanel: 'variables',
      consoleVisible: false,
    });
  });
});
