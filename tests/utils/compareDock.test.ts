import { beforeEach, describe, expect, it } from 'vitest';
import { isCompareDockOpen, toggleCompareDock } from '../../src/renderer/utils/compareDock';
import { useUIStore } from '../../src/renderer/stores/uiStore';

beforeEach(() => {
  useUIStore.setState({ consoleVisible: false, activeBottomPanel: 'console' });
});

describe('compare dock toggle', () => {
  it('opens the dock on Compare, then returns it to Console', () => {
    expect(toggleCompareDock()).toBe(true);
    expect(useUIStore.getState()).toMatchObject({ consoleVisible: true, activeBottomPanel: 'compare' });
    expect(isCompareDockOpen()).toBe(true);

    expect(toggleCompareDock()).toBe(false);
    expect(useUIStore.getState()).toMatchObject({ consoleVisible: true, activeBottomPanel: 'console' });
  });

  it('treats a hidden dock on Compare as closed', () => {
    useUIStore.setState({ consoleVisible: false, activeBottomPanel: 'compare' });
    expect(isCompareDockOpen()).toBe(false);
    expect(toggleCompareDock()).toBe(true);
  });
});
