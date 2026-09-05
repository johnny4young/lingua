import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dependencyTelemetryDedupSizeForTests,
  primeDependencyTelemetryDedupForTests,
  useDependencyDetection,
} from '../../src/renderer/hooks/useDependencyDetection';
import { useDependencyDetectionStore } from '../../src/renderer/stores/dependencyDetectionStore';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import { loadDependencyAdapter } from '../../src/shared/dependencies/registry';
import type { DependencyAdapter } from '../../src/shared/dependencies/types';
import { classifyDependencies } from '../../src/renderer/hooks/dependencyDetectionRuntime';

const runtimeMocks = vi.hoisted(() => ({
  loadRuntime: vi.fn(),
}));

vi.mock('../../src/renderer/hooks/dependencyDetectionRuntimeLoader', () => ({
  loadDependencyDetectionRuntime: runtimeMocks.loadRuntime,
}));

vi.mock('../../src/shared/dependencies/registry', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../src/shared/dependencies/registry')
    >();
  return {
    ...actual,
    loadDependencyAdapter: vi.fn(actual.loadDependencyAdapter),
  };
});

describe('useDependencyDetection', () => {
  beforeEach(() => {
    runtimeMocks.loadRuntime.mockReset();
    runtimeMocks.loadRuntime.mockResolvedValue({ classifyDependencies });
    vi.mocked(loadDependencyAdapter).mockClear();
    delete (window as unknown as { lingua?: unknown }).lingua;
    useDependencyDetectionStore.getState().clear();
    useUIStore.setState({ statusNotice: null });
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

  it('drops the once-per-tab telemetry keys when their tab closes', () => {
    const before = dependencyTelemetryDedupSizeForTests();
    primeDependencyTelemetryDedupForTests('closing-tab', 'javascript');
    primeDependencyTelemetryDedupForTests('active-tab', 'javascript');
    expect(dependencyTelemetryDedupSizeForTests()).toBe(before + 4);

    // Closing a tab replaces the tabs array; only the live tab's keys survive.
    act(() => {
      useEditorStore.setState({
        tabs: useEditorStore.getState().tabs.filter((tab) => tab.id === 'active-tab'),
      });
    });
    expect(dependencyTelemetryDedupSizeForTests()).toBe(before + 2);

    // Priming the survivor again is a no-op: the de-dup still holds for it.
    primeDependencyTelemetryDedupForTests('active-tab', 'javascript');
    expect(dependencyTelemetryDedupSizeForTests()).toBe(before + 2);
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

  it('records an empty result without loading a detector for ordinary source', async () => {
    useEditorStore.setState({
      tabs: [
        {
          id: 'active-tab',
          name: 'active.js',
          language: 'javascript',
          content: 'const answer = 40 + 2;\nconsole.log(answer);\n',
          isDirty: false,
        },
      ],
      activeTabId: 'active-tab',
    });

    renderHook(() => useDependencyDetection());

    await waitFor(() => {
      expect(
        useDependencyDetectionStore.getState().byTab.get('active-tab')
          ?.dependencies
      ).toEqual([]);
    });
    expect(loadDependencyAdapter).not.toHaveBeenCalled();
  });

  it('cancels a pending lazy adapter load when detection is disabled', async () => {
    let resolveAdapter!: (adapter: DependencyAdapter) => void;
    const adapterPromise = new Promise<DependencyAdapter>((resolve) => {
      resolveAdapter = resolve;
    });
    const detect = vi.fn(() => [
      { name: 'lodash', kind: 'import' as const },
    ]);
    vi.mocked(loadDependencyAdapter).mockReturnValueOnce(adapterPromise);

    renderHook(() => useDependencyDetection());

    await waitFor(() => {
      expect(loadDependencyAdapter).toHaveBeenCalledWith('javascript');
    });

    act(() => {
      useSettingsStore.setState({ dependencyDetectionEnabled: false });
    });
    resolveAdapter({ language: 'javascript', detect });

    await waitFor(() => {
      expect(useDependencyDetectionStore.getState().byTab.size).toBe(0);
    });
    expect(detect).not.toHaveBeenCalled();
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

  it('reclassifies the same buffer when the saved file path changes', async () => {
    const resolveJs = vi.fn(async (_names: readonly string[], filePath?: string) => ({
      statuses: { lodash: 'detected' as const },
      cwd: filePath ? filePath.replace(/\/[^/]+$/u, '') : null,
      hasPackageJson: filePath?.includes('project-b') ?? false,
    }));
    (window as unknown as { lingua: unknown }).lingua = {
      platform: 'electron',
      dependencies: { resolveJs },
    };
    useEditorStore.setState({
      tabs: [
        {
          id: 'active-tab',
          name: 'active.js',
          language: 'javascript',
          content: "import x from 'lodash';",
          isDirty: false,
          filePath: '/project-a/active.js',
        },
      ],
      activeTabId: 'active-tab',
    });

    renderHook(() => useDependencyDetection());

    await waitFor(() => {
      expect(resolveJs).toHaveBeenCalledWith(['lodash'], '/project-a/active.js');
    });
    expect(
      useDependencyDetectionStore.getState().byTab.get('active-tab')
        ?.cwdHasPackageJson
    ).toBe(false);

    useEditorStore.setState({
      tabs: [
        {
          id: 'active-tab',
          name: 'active.js',
          language: 'javascript',
          content: "import x from 'lodash';",
          isDirty: false,
          filePath: '/project-b/active.js',
        },
      ],
      activeTabId: 'active-tab',
    });

    await waitFor(() => {
      expect(resolveJs).toHaveBeenCalledWith(['lodash'], '/project-b/active.js');
    });
    expect(
      useDependencyDetectionStore.getState().byTab.get('active-tab')
        ?.cwdHasPackageJson
    ).toBe(true);
  });

  it('surfaces localized recovery and retries after the runtime cannot load', async () => {
    runtimeMocks.loadRuntime
      .mockRejectedValueOnce(new Error('dependency runtime unavailable'))
      .mockResolvedValueOnce({ classifyDependencies });

    renderHook(() => useDependencyDetection());

    await waitFor(() => {
      expect(useUIStore.getState().statusNotice).toMatchObject({
        tone: 'error',
        messageKey: 'dependencies.detectionLoadFailed',
      });
    });
    expect(useDependencyDetectionStore.getState().byTab.size).toBe(0);

    act(() => {
      useEditorStore.setState({
        tabs: [
          {
            id: 'active-tab',
            name: 'active.js',
            language: 'javascript',
            content: "import sortBy from 'lodash';",
            isDirty: true,
          },
        ],
        activeTabId: 'active-tab',
      });
    });

    await waitFor(() => {
      expect(
        useDependencyDetectionStore.getState().byTab.get('active-tab')
          ?.dependencies
      ).toEqual([
        { name: 'lodash', kind: 'import', status: 'detected' },
      ]);
    });
    expect(runtimeMocks.loadRuntime).toHaveBeenCalledTimes(2);
  });
});
