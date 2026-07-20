/**
 * implementation — DependenciesPanel Python web install lifecycle tests.
 *
 * Pins:
 *   - Web Python tab enables the Install button without a filePath or
 *     package.json (the install path is Pyodide micropip, not npm).
 *   - Click → row transitions to `'installing'` then to `'installed'`.
 *   - unsupported-wheel failureReason maps the row to `'unsupported'`.
 *   - Cancel button is HIDDEN for Python web installs (implementation note rejected).
 *   - ES locale renders the new tuteo strings.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import i18next from 'i18next';
import { DependenciesPanel } from '../../src/renderer/components/Dependencies/DependenciesPanel';
import { useDependencyDetectionStore } from '../../src/renderer/stores/dependencyDetectionStore';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';

// Module-level mock for the installer service. Each test resets the
// mocked behaviour via the helper below.
const installPythonMock = vi.fn();
const listLoadedPackagesMock = vi.fn();
vi.mock('../../src/renderer/services/pythonWebInstaller', () => ({
  installPython: (args: unknown) => installPythonMock(args),
  listLoadedPackages: () => listLoadedPackagesMock(),
}));

function setWebPlatform(): void {
  (window as unknown as { lingua: unknown }).lingua = {
    platform: 'web',
    // implementation does not need a bridge for Python web — the service
    // module handles micropip.
  };
}

function setActivePythonTab(id: string): void {
  act(() => {
    useEditorStore.setState({
      activeTabId: id,
      tabs: [
        {
          id,
          name: 'tab.py',
          language: 'python',
          content: '',
          isDirty: false,
        },
      ],
    });
  });
}

function seedPythonDetection(args: {
  tabId: string;
  rows: ReadonlyArray<{
    name: string;
    status:
      | 'detected'
      | 'installed'
      | 'installing'
      | 'failed'
      | 'unsupported'
      | 'needs-desktop';
  }>;
}): void {
  act(() => {
    useDependencyDetectionStore.getState().setDetection(args.tabId, {
      tabId: args.tabId,
      language: 'python',
      detectionHash: 'h',
      dependencies: args.rows.map((row) => ({
        name: row.name,
        kind: 'from',
        status: row.status,
      })),
      classifiedAt: 1,
    });
  });
}

beforeEach(async () => {
  await i18next.changeLanguage('en');
  installPythonMock.mockReset();
  listLoadedPackagesMock.mockReset();
  listLoadedPackagesMock.mockResolvedValue([]);
  act(() => {
    useDependencyDetectionStore.getState().clear();
    useSettingsStore.setState({ dependencyDetectionEnabled: true });
    useEditorStore.setState({ activeTabId: null, tabs: [] });
  });
  setWebPlatform();
});

describe('DependenciesPanel — Python web install ', () => {
  it('enables Install on a Python web row without filePath / package.json', () => {
    setActivePythonTab('tab-py');
    seedPythonDetection({
      tabId: 'tab-py',
      rows: [{ name: 'requests', status: 'detected' }],
    });
    render(<DependenciesPanel />);
    const btn = screen.getByTestId(
      'dependency-install-requests'
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.title).toMatch(/Pyodide micropip/u);
  });

  it('flips row to installing → installed on successful micropip install', async () => {
    let resolveInstall:
      | ((value: {
          statuses: Record<string, string>;
          outcome: string;
          failureReason: string | null;
        }) => void)
      | null = null;
    installPythonMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInstall = resolve as typeof resolveInstall;
        })
    );

    setActivePythonTab('tab-py-flow');
    seedPythonDetection({
      tabId: 'tab-py-flow',
      rows: [{ name: 'requests', status: 'detected' }],
    });
    render(<DependenciesPanel />);

    fireEvent.click(screen.getByTestId('dependency-install-requests'));
    await new Promise((r) => setTimeout(r, 600));

    expect(installPythonMock).toHaveBeenCalledTimes(1);
    const [args] = installPythonMock.mock.calls[0]!;
    expect(args.specifiers).toEqual(['requests']);

    await waitFor(() => {
      const pill = screen.getByTestId('dependency-status-requests');
      expect(pill.textContent).toMatch(/Installing/u);
    });

    act(() => {
      resolveInstall!({
        statuses: { requests: 'installed' },
        outcome: 'success',
        failureReason: null,
      });
    });

    await waitFor(() => {
      const pill = screen.getByTestId('dependency-status-requests');
      expect(pill.textContent).toMatch(/Installed/u);
    });
  });

  it('maps unsupported-wheel failure to row.status === unsupported (singleton)', async () => {
    installPythonMock.mockResolvedValue({
      statuses: { psycopg2: 'failed' },
      outcome: 'failed',
      failureReason: 'unsupported-wheel',
    });

    setActivePythonTab('tab-py-unsupported');
    seedPythonDetection({
      tabId: 'tab-py-unsupported',
      rows: [{ name: 'psycopg2', status: 'detected' }],
    });
    render(<DependenciesPanel />);

    fireEvent.click(screen.getByTestId('dependency-install-psycopg2'));
    await new Promise((r) => setTimeout(r, 600));

    await waitFor(() => {
      const pill = screen.getByTestId('dependency-status-psycopg2');
      expect(pill.textContent).toMatch(/Not supported/u);
    });
  });

  it('keeps multi-name unsupported-wheel batches as failed (reviewer fix)', async () => {
    // implementation reviewer fix — `micropip.install` reports one
    // batch-level error. If the user clicks "Install all" on two
    // detected Python rows and Pyodide rejects the batch with
    // `unsupported-wheel`, we cannot disambiguate which name was the
    // wheel issue. The renderer must map every `'failed'` row to
    // `'failed'`, not `'unsupported'`, to avoid mis-labelling
    // pure-Python packages as wheel-rejected.
    installPythonMock.mockResolvedValue({
      statuses: { 'numpy': 'failed', 'psycopg2': 'failed' },
      outcome: 'failed',
      failureReason: 'unsupported-wheel',
    });

    setActivePythonTab('tab-py-batch');
    seedPythonDetection({
      tabId: 'tab-py-batch',
      rows: [
        { name: 'numpy', status: 'detected' },
        { name: 'psycopg2', status: 'detected' },
      ],
    });
    render(<DependenciesPanel />);

    // "Install all" surfaces because ≥2 detected rows on a Python
    // web tab. Click it to trigger a multi-name batch.
    fireEvent.click(screen.getByTestId('dependencies-install-all'));
    await new Promise((r) => setTimeout(r, 50));

    await waitFor(() => {
      const numpyPill = screen.getByTestId('dependency-status-numpy');
      const psycopgPill = screen.getByTestId('dependency-status-psycopg2');
      expect(numpyPill.textContent).toMatch(/Install failed/u);
      expect(psycopgPill.textContent).toMatch(/Install failed/u);
    });
  });

  it('surfaces pythonUnsupportedTooltip on unsupported rows (reviewer fix)', () => {
    setActivePythonTab('tab-py-unsupported-tooltip');
    seedPythonDetection({
      tabId: 'tab-py-unsupported-tooltip',
      rows: [{ name: 'psycopg2', status: 'unsupported' }],
    });
    render(<DependenciesPanel />);
    const btn = screen.getByTestId(
      'dependency-install-psycopg2'
    ) as HTMLButtonElement;
    expect(btn.title).toMatch(/Pyodide has no compatible wheel/u);
  });

  it('hides the cancel button for Python web installs (implementation note rejected)', async () => {
    installPythonMock.mockImplementation(
      () => new Promise<never>(() => {})
    );

    setActivePythonTab('tab-py-no-cancel');
    seedPythonDetection({
      tabId: 'tab-py-no-cancel',
      rows: [{ name: 'requests', status: 'detected' }],
    });
    render(<DependenciesPanel />);

    fireEvent.click(screen.getByTestId('dependency-install-requests'));
    await new Promise((r) => setTimeout(r, 600));

    // Wait for the log surface to mount (it gates on isInstalling),
    // then assert the cancel button is absent.
    await waitFor(() => {
      expect(screen.getByTestId('dependencies-install-log')).toBeTruthy();
    });
    expect(screen.queryByTestId('dependencies-install-cancel')).toBeNull();
  });

  it('renders the Pyodide tooltip in Spanish tuteo under ES locale', async () => {
    await i18next.changeLanguage('es');
    try {
      setActivePythonTab('tab-py-es');
      seedPythonDetection({
        tabId: 'tab-py-es',
        rows: [{ name: 'requests', status: 'detected' }],
      });
      render(<DependenciesPanel />);
      const btn = screen.getByTestId(
        'dependency-install-requests'
      ) as HTMLButtonElement;
      expect(btn.title).toMatch(/Instala vía Pyodide micropip/u);
    } finally {
      await i18next.changeLanguage('en');
    }
  });
});
