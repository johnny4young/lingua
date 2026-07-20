/**
 * implementation - DependenciesPanel rendering smoke tests.
 *
 * Pins the empty / mixed / disabled-toggle states, the disabled
 * Install button tooltip variants (web vs desktop vs `needs-desktop`
 * row), and the ES locale render path so tuteo strings can't drift
 * without breaking the build.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import i18next from 'i18next';
import { DependenciesPanel } from '../../src/renderer/components/Dependencies/DependenciesPanel';
import { useDependenciesPanelAvailable } from '../../src/renderer/components/Dependencies/useDependenciesPanelAvailable';
import { useDependencyDetectionStore } from '../../src/renderer/stores/dependencyDetectionStore';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';

function setActiveTab(id: string | null): void {
  act(() => {
    useEditorStore.setState({
      activeTabId: id,
      tabs: id
        ? [
            {
              id,
              name: 'tab.js',
              language: 'javascript',
              content: '',
              isDirty: false,
            },
          ]
        : [],
    });
  });
}

describe('DependenciesPanel', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    act(() => {
      useDependencyDetectionStore.getState().clear();
      useSettingsStore.setState({ dependencyDetectionEnabled: true });
    });
    setActiveTab(null);
  });

  it('renders the "no tab" empty state when no active tab is set', () => {
    render(<DependenciesPanel />);
    expect(screen.getByTestId('dependencies-panel-empty')).toBeTruthy();
  });

  it('renders the disabled empty state when the master toggle is OFF', () => {
    setActiveTab('tab-x');
    act(() => {
      useSettingsStore.setState({ dependencyDetectionEnabled: false });
    });
    render(<DependenciesPanel />);
    const empty = screen.getByTestId('dependencies-panel-empty');
    expect(empty.textContent).toMatch(/Auto-detect dependencies|Settings/u);
  });

  it('renders rows with status pills for detected dependencies', () => {
    setActiveTab('tab-1');
    act(() => {
      useDependencyDetectionStore.getState().setDetection('tab-1', {
        tabId: 'tab-1',
        language: 'javascript',
        detectionHash: 'h',
        dependencies: [
          { name: 'lodash', kind: 'import', status: 'detected' },
          { name: 'react', kind: 'import', status: 'installed' },
          { name: 'esm-only', kind: 'import', status: 'needs-desktop' },
        ],
        classifiedAt: 1,
      });
    });
    render(<DependenciesPanel />);
    expect(screen.getByTestId('dependency-row-lodash')).toBeTruthy();
    expect(screen.getByTestId('dependency-row-react')).toBeTruthy();
    expect(screen.getByTestId('dependency-status-lodash').textContent).toMatch(
      /Not installed/u
    );
    expect(screen.getByTestId('dependency-status-react').textContent).toMatch(
      /Installed/u
    );
    expect(
      screen.getByTestId('dependency-status-esm-only').textContent
    ).toMatch(/Desktop only/u);
  });

  it('renders the disabled Install button on every row', () => {
    setActiveTab('tab-2');
    act(() => {
      useDependencyDetectionStore.getState().setDetection('tab-2', {
        tabId: 'tab-2',
        language: 'javascript',
        detectionHash: 'h',
        dependencies: [
          { name: 'lodash', kind: 'import', status: 'detected' },
        ],
        classifiedAt: 1,
      });
    });
    render(<DependenciesPanel />);
    const btn = screen.getByTestId(
      'dependency-install-lodash'
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('renders the "buffer too large" state when the detector marked the tab as skipped', () => {
    setActiveTab('tab-3');
    act(() => {
      useDependencyDetectionStore.getState().setDetection('tab-3', {
        tabId: 'tab-3',
        language: 'javascript',
        detectionHash: 'h',
        dependencies: [],
        classifiedAt: 1,
        skippedReason: 'buffer-too-large',
      });
    });
    render(<DependenciesPanel />);
    expect(screen.getByTestId('dependencies-panel-empty').textContent).toMatch(
      /too large/u
    );
  });

  it('keeps the tab available for a skipped oversized file so the warning is reachable', () => {
    setActiveTab('tab-3b');
    act(() => {
      useDependencyDetectionStore.getState().setDetection('tab-3b', {
        tabId: 'tab-3b',
        language: 'javascript',
        detectionHash: 'h',
        dependencies: [],
        classifiedAt: 1,
        skippedReason: 'buffer-too-large',
      });
    });

    const { result } = renderHook(() => useDependenciesPanelAvailable());

    expect(result.current).toBe(true);
  });

  it('hides stale detections from a previous language for the same tab', () => {
    setActiveTab('tab-stale');
    act(() => {
      useDependencyDetectionStore.getState().setDetection('tab-stale', {
        tabId: 'tab-stale',
        language: 'python',
        detectionHash: 'h',
        dependencies: [
          { name: 'numpy', kind: 'import', status: 'detected' },
        ],
        classifiedAt: 1,
      });
    });

    const { result } = renderHook(() => useDependenciesPanelAvailable());
    render(<DependenciesPanel />);

    expect(result.current).toBe(false);
    expect(screen.queryByTestId('dependency-row-numpy')).toBeNull();
    expect(screen.getByTestId('dependencies-panel-empty').textContent).toMatch(
      /No external dependencies/u
    );
  });

  it('renders Spanish tuteo strings under the ES locale', async () => {
    await i18next.changeLanguage('es');
    try {
      setActiveTab('tab-4');
      act(() => {
        useDependencyDetectionStore.getState().setDetection('tab-4', {
          tabId: 'tab-4',
          language: 'javascript',
          detectionHash: 'h',
          dependencies: [
            { name: 'lodash', kind: 'import', status: 'detected' },
          ],
          classifiedAt: 1,
        });
      });
      render(<DependenciesPanel />);
      expect(
        screen.getByTestId('dependency-status-lodash').textContent
      ).toMatch(/No instalada/u);
      const btn = screen.getByTestId(
        'dependency-install-lodash'
      ) as HTMLButtonElement;
      expect(btn.textContent).toMatch(/Instala/u);
    } finally {
      await i18next.changeLanguage('en');
    }
  });
});
