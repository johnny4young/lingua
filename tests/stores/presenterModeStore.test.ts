/**
 * implementation — presenter mode is a render-time override, so the
 * lock here is twofold: the toggle flips cleanly, and the underlying
 * preference stores are NEVER mutated by entering/leaving the mode
 * (that is what makes restoration lossless across toggles or reloads).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  PRESENTER_CONSOLE_FONT_LIFT,
  PRESENTER_EDITOR_FONT_LIFT,
  usePresenterModeStore,
} from '../../src/renderer/stores/presenterModeStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';

beforeEach(() => {
  usePresenterModeStore.setState({ active: false });
});

describe('presenterModeStore', () => {
  it('toggles on and off', () => {
    expect(usePresenterModeStore.getState().active).toBe(false);
    usePresenterModeStore.getState().toggle();
    expect(usePresenterModeStore.getState().active).toBe(true);
    usePresenterModeStore.getState().toggle();
    expect(usePresenterModeStore.getState().active).toBe(false);
  });

  it('never mutates the underlying layout/font preferences', () => {
    const sidebarBefore = useUIStore.getState().sidebarVisible;
    const fontBefore = useSettingsStore.getState().fontSize;
    const statusBefore = useSettingsStore.getState().showStatusBar;

    usePresenterModeStore.getState().toggle();
    expect(useUIStore.getState().sidebarVisible).toBe(sidebarBefore);
    expect(useSettingsStore.getState().fontSize).toBe(fontBefore);
    expect(useSettingsStore.getState().showStatusBar).toBe(statusBefore);

    usePresenterModeStore.getState().toggle();
    expect(useUIStore.getState().sidebarVisible).toBe(sidebarBefore);
    expect(useSettingsStore.getState().fontSize).toBe(fontBefore);
    expect(useSettingsStore.getState().showStatusBar).toBe(statusBefore);
  });

  it('exports the promised whole-pixel font lifts', () => {
    expect(PRESENTER_EDITOR_FONT_LIFT).toBe(4);
    expect(PRESENTER_CONSOLE_FONT_LIFT).toBe(2);
  });
});
