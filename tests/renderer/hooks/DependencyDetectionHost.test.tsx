import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DependencyDetectionHost } from '../../../src/renderer/hooks/DependencyDetectionHost';
import { useDependencyDetectionStore } from '../../../src/renderer/stores/dependencyDetectionStore';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';

describe('DependencyDetectionHost', () => {
  let idleCallback: (() => void) | undefined;

  beforeEach(() => {
    idleCallback = undefined;
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((callback: () => void) => {
        idleCallback = callback;
        return 1;
      })
    );
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    useDependencyDetectionStore.getState().clear();
    useSettingsStore.setState({ dependencyDetectionEnabled: true });
    useEditorStore.setState({
      tabs: [
        {
          id: 'active-tab',
          name: 'active.js',
          language: 'javascript',
          content: 'const answer = 40 + 2;',
          isDirty: false,
        },
      ],
      activeTabId: 'active-tab',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('waits for browser idle before activating dependency detection', async () => {
    render(<DependencyDetectionHost />);

    expect(requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(useDependencyDetectionStore.getState().byTab.size).toBe(0);

    act(() => idleCallback?.());

    await waitFor(() => {
      expect(
        useDependencyDetectionStore.getState().byTab.get('active-tab')
          ?.dependencies
      ).toEqual([]);
    });
  });

  it('does not schedule or fetch detection while the preference starts disabled', () => {
    useSettingsStore.setState({ dependencyDetectionEnabled: false });

    render(<DependencyDetectionHost />);

    expect(requestIdleCallback).not.toHaveBeenCalled();
    expect(idleCallback).toBeUndefined();
    expect(useDependencyDetectionStore.getState().byTab.size).toBe(0);
  });
});
