import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDependencyDetection } from '../../src/renderer/hooks/useDependencyDetection';
import { useDependencyDetectionStore } from '../../src/renderer/stores/dependencyDetectionStore';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';

describe('useDependencyDetection', () => {
  beforeEach(() => {
    useDependencyDetectionStore.getState().clear();
    useSettingsStore.setState({ dependencyDetectionEnabled: true });
    useEditorStore.setState({
      tabs: [
        {
          id: 'active-tab',
          name: 'active.js',
          language: 'javascript',
          content: "import x from 'lodash';",
          isDirty: false,
        },
      ],
      activeTabId: 'active-tab',
      pendingReveal: null,
    });
  });

  it('clears every cached tab when dependency detection is disabled', async () => {
    const store = useDependencyDetectionStore.getState();
    store.setDetection('active-tab', {
      tabId: 'active-tab',
      language: 'javascript',
      detectionHash: 'active',
      dependencies: [{ name: 'lodash', kind: 'import', status: 'detected' }],
      classifiedAt: 1,
    });
    store.setDetection('inactive-tab', {
      tabId: 'inactive-tab',
      language: 'python',
      detectionHash: 'inactive',
      dependencies: [{ name: 'numpy', kind: 'import', status: 'detected' }],
      classifiedAt: 1,
    });

    useSettingsStore.setState({ dependencyDetectionEnabled: false });

    renderHook(() => useDependencyDetection());

    await waitFor(() => {
      expect(useDependencyDetectionStore.getState().byTab.size).toBe(0);
    });
  });

  it('evicts stale entries when the active tab moves to an unsupported language', async () => {
    const store = useDependencyDetectionStore.getState();
    store.setDetection('active-tab', {
      tabId: 'active-tab',
      language: 'javascript',
      detectionHash: 'active',
      dependencies: [{ name: 'lodash', kind: 'import', status: 'detected' }],
      classifiedAt: 1,
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 'active-tab',
          name: 'active.go',
          language: 'go',
          content: 'package main',
          isDirty: false,
        },
      ],
      activeTabId: 'active-tab',
    });

    renderHook(() => useDependencyDetection());

    await waitFor(() => {
      expect(useDependencyDetectionStore.getState().byTab.has('active-tab')).toBe(
        false
      );
    });
  });
});
