/**
 * RL-025 Slice B — DependenciesPanel install lifecycle tests.
 *
 * Pins the enable matrix for the Install button (web vs unsaved tab
 * vs missing package.json vs healthy desktop), the optimistic
 * `'installing'` transition after click, the post-resolution
 * `'installed'` / `'failed'` flips, fold-B coalescing across rapid
 * clicks, the cancel button, the streaming log surface, the "Install
 * all" header button (fold F), and the ES locale render.
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

interface MockBridge {
  resolveJs: ReturnType<typeof vi.fn>;
  installJs: ReturnType<typeof vi.fn>;
  cancelInstallJs: ReturnType<typeof vi.fn>;
  onInstallLogJs: ReturnType<typeof vi.fn>;
}

function installMockBridge(overrides: Partial<MockBridge> = {}): MockBridge {
  const bridge: MockBridge = {
    resolveJs: vi.fn(),
    installJs: vi.fn(),
    cancelInstallJs: vi.fn(),
    onInstallLogJs: vi.fn(() => () => {}),
    ...overrides,
  };
  (window as unknown as { lingua: unknown }).lingua = {
    platform: 'electron',
    dependencies: bridge,
  };
  return bridge;
}

function setActiveTab(args: {
  id: string;
  filePath?: string;
  language?: string;
}): void {
  act(() => {
    useEditorStore.setState({
      activeTabId: args.id,
      tabs: [
        {
          id: args.id,
          name: 'tab.js',
          language: args.language ?? 'javascript',
          content: '',
          isDirty: false,
          ...(args.filePath !== undefined ? { filePath: args.filePath } : {}),
        },
      ],
    });
  });
}

function seedDetection(args: {
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
  cwdHasPackageJson?: boolean | null;
}): void {
  act(() => {
    useDependencyDetectionStore.getState().setDetection(args.tabId, {
      tabId: args.tabId,
      language: 'javascript',
      detectionHash: 'h',
      dependencies: args.rows.map((row) => ({
        name: row.name,
        kind: 'import',
        status: row.status,
      })),
      classifiedAt: 1,
      cwdHasPackageJson: args.cwdHasPackageJson ?? true,
    });
  });
}

beforeEach(async () => {
  await i18next.changeLanguage('en');
  act(() => {
    useDependencyDetectionStore.getState().clear();
    useSettingsStore.setState({ dependencyDetectionEnabled: true });
    useEditorStore.setState({ activeTabId: null, tabs: [] });
  });
  installMockBridge();
});

describe('Install button enable matrix', () => {
  it('disables Install on a web build', () => {
    (window as unknown as { lingua: { platform: string } }).lingua = {
      platform: 'web',
      // dependencies bridge intentionally omitted — should not be reached.
    } as { platform: string };
    setActiveTab({ id: 'tab-web', filePath: '/p/file.js' });
    seedDetection({
      tabId: 'tab-web',
      rows: [{ name: 'lodash', status: 'detected' }],
    });
    render(<DependenciesPanel />);
    const btn = screen.getByTestId(
      'dependency-install-lodash'
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/Open Lingua Desktop/u);
  });

  it('disables Install on an unsaved tab with a tab-save tooltip', () => {
    setActiveTab({ id: 'tab-unsaved' });
    seedDetection({
      tabId: 'tab-unsaved',
      rows: [{ name: 'lodash', status: 'detected' }],
      cwdHasPackageJson: null,
    });
    render(<DependenciesPanel />);
    const btn = screen.getByTestId(
      'dependency-install-lodash'
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/Save this tab/u);
  });

  it('disables Install when the cwd lacks a package.json', () => {
    setActiveTab({ id: 'tab-no-pkg', filePath: '/scratch/loose.js' });
    seedDetection({
      tabId: 'tab-no-pkg',
      rows: [{ name: 'lodash', status: 'detected' }],
      cwdHasPackageJson: false,
    });
    render(<DependenciesPanel />);
    const btn = screen.getByTestId(
      'dependency-install-lodash'
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/package\.json/u);
  });

  it('enables Install in the healthy desktop case', () => {
    setActiveTab({ id: 'tab-ok', filePath: '/p/file.js' });
    seedDetection({
      tabId: 'tab-ok',
      rows: [{ name: 'lodash', status: 'detected' }],
      cwdHasPackageJson: true,
    });
    render(<DependenciesPanel />);
    const btn = screen.getByTestId(
      'dependency-install-lodash'
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('keeps Install disabled on rows already in a non-detected state', () => {
    setActiveTab({ id: 'tab-mix', filePath: '/p/file.js' });
    seedDetection({
      tabId: 'tab-mix',
      rows: [
        { name: 'installed-pkg', status: 'installed' },
        { name: 'failed-pkg', status: 'failed' },
        { name: 'needs-desktop-pkg', status: 'needs-desktop' },
      ],
      cwdHasPackageJson: true,
    });
    render(<DependenciesPanel />);
    expect(
      (
        screen.getByTestId(
          'dependency-install-installed-pkg'
        ) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (
        screen.getByTestId('dependency-install-failed-pkg') as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (
        screen.getByTestId(
          'dependency-install-needs-desktop-pkg'
        ) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });
});

describe('Install flow', () => {
  it('flips a row to installing on click, then to installed on success', async () => {
    let resolveInstall: ((value: DependencyInstallResult) => void) | null =
      null;
    const installPromise = new Promise<DependencyInstallResult>((resolve) => {
      resolveInstall = resolve;
    });
    const bridge = installMockBridge({
      installJs: vi.fn(() => installPromise),
    });

    setActiveTab({ id: 'tab-flow', filePath: '/p/file.js' });
    seedDetection({
      tabId: 'tab-flow',
      rows: [{ name: 'lodash', status: 'detected' }],
      cwdHasPackageJson: true,
    });
    render(<DependenciesPanel />);

    fireEvent.click(screen.getByTestId('dependency-install-lodash'));
    // Fold-B coalescing window — let the debounce fire.
    await new Promise((r) => setTimeout(r, 600));

    expect(bridge.installJs).toHaveBeenCalledTimes(1);
    const [_runId, names, filePath] = bridge.installJs.mock.calls[0]!;
    expect(names).toEqual(['lodash']);
    expect(filePath).toBe('/p/file.js');

    await waitFor(() => {
      const pill = screen.getByTestId('dependency-status-lodash');
      expect(pill.textContent).toMatch(/Installing/u);
    });

    act(() => {
      resolveInstall!({
        statuses: { lodash: 'installed' },
        outcome: 'success',
        failureReason: null,
        cwd: '/p',
        exitCode: 0,
      });
    });

    await waitFor(() => {
      const pill = screen.getByTestId('dependency-status-lodash');
      expect(pill.textContent).toMatch(/Installed/u);
    });
  });

  it('flips a row back to detected after a successful cancel', async () => {
    // Hold the install promise open until the cancel handler decides
    // to resolve it — mirrors the real main-side behaviour where
    // `npm install` only exits after a SIGTERM lands.
    let resolveInstall: ((value: DependencyInstallResult) => void) | null =
      null;
    const installPromise = new Promise<DependencyInstallResult>((resolve) => {
      resolveInstall = resolve;
    });
    const bridge = installMockBridge({
      installJs: vi.fn(() => installPromise),
      cancelInstallJs: vi.fn(async () => {
        resolveInstall?.({
          statuses: { lodash: 'cancelled' },
          outcome: 'cancelled',
          failureReason: 'cancelled',
          cwd: '/p',
          exitCode: -1,
        });
        return { cancelled: true };
      }),
    });

    setActiveTab({ id: 'tab-cancel', filePath: '/p/file.js' });
    seedDetection({
      tabId: 'tab-cancel',
      rows: [{ name: 'lodash', status: 'detected' }],
      cwdHasPackageJson: true,
    });
    render(<DependenciesPanel />);

    fireEvent.click(screen.getByTestId('dependency-install-lodash'));
    await new Promise((r) => setTimeout(r, 600));

    await waitFor(() => {
      expect(screen.getByTestId('dependencies-install-cancel')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('dependencies-install-cancel'));
    expect(bridge.cancelInstallJs).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      const pill = screen.getByTestId('dependency-status-lodash');
      expect(pill.textContent).toMatch(/Not installed/u);
    });
  });

  it('coalesces multiple rapid clicks into a single batched install (fold B)', async () => {
    const bridge = installMockBridge({
      installJs: vi.fn(async () => ({
        statuses: { lodash: 'installed', 'date-fns': 'installed' },
        outcome: 'success' as const,
        failureReason: null,
        cwd: '/p',
        exitCode: 0,
      })),
    });

    setActiveTab({ id: 'tab-batch', filePath: '/p/file.js' });
    seedDetection({
      tabId: 'tab-batch',
      rows: [
        { name: 'lodash', status: 'detected' },
        { name: 'date-fns', status: 'detected' },
      ],
      cwdHasPackageJson: true,
    });
    render(<DependenciesPanel />);

    fireEvent.click(screen.getByTestId('dependency-install-lodash'));
    fireEvent.click(screen.getByTestId('dependency-install-date-fns'));
    await new Promise((r) => setTimeout(r, 700));

    expect(bridge.installJs).toHaveBeenCalledTimes(1);
    const [, names] = bridge.installJs.mock.calls[0]!;
    expect((names as string[]).sort()).toEqual(['date-fns', 'lodash']);
  });

  it('disables other install buttons while one install is in flight', async () => {
    installMockBridge({
      installJs: vi.fn(
        () => new Promise<DependencyInstallResult>(() => {})
      ),
    });

    setActiveTab({ id: 'tab-inflight', filePath: '/p/file.js' });
    seedDetection({
      tabId: 'tab-inflight',
      rows: [
        { name: 'lodash', status: 'detected' },
        { name: 'date-fns', status: 'detected' },
      ],
      cwdHasPackageJson: true,
    });
    render(<DependenciesPanel />);

    fireEvent.click(screen.getByTestId('dependency-install-lodash'));
    await new Promise((r) => setTimeout(r, 600));

    await waitFor(() => {
      const other = screen.getByTestId(
        'dependency-install-date-fns'
      ) as HTMLButtonElement;
      expect(other.disabled).toBe(true);
      expect(other.title).toMatch(/current install/u);
    });
  });

  it('renders the "Install all" header button when ≥2 rows are detected', () => {
    setActiveTab({ id: 'tab-all', filePath: '/p/file.js' });
    seedDetection({
      tabId: 'tab-all',
      rows: [
        { name: 'lodash', status: 'detected' },
        { name: 'date-fns', status: 'detected' },
        { name: 'react', status: 'installed' },
      ],
      cwdHasPackageJson: true,
    });
    render(<DependenciesPanel />);
    const btn = screen.getByTestId('dependencies-install-all');
    expect(btn.textContent).toMatch(/Install 2 packages/u);
  });

  it('does not render "Install all" when only a single row is detected', () => {
    setActiveTab({ id: 'tab-one', filePath: '/p/file.js' });
    seedDetection({
      tabId: 'tab-one',
      rows: [
        { name: 'lodash', status: 'detected' },
        { name: 'react', status: 'installed' },
      ],
      cwdHasPackageJson: true,
    });
    render(<DependenciesPanel />);
    expect(screen.queryByTestId('dependencies-install-all')).toBeNull();
  });

  it('appends streamed log chunks to the install log surface', async () => {
    let logHandler: ((event: DependencyInstallLogEvent) => void) | null = null;
    installMockBridge({
      installJs: vi.fn(
        () =>
          new Promise<DependencyInstallResult>(() => {
            // Never resolve in this test — we just want to observe the
            // log surface while the install is "running".
          })
      ),
      onInstallLogJs: vi.fn(
        (handler: (event: DependencyInstallLogEvent) => void) => {
          logHandler = handler;
          return () => {};
        }
      ),
    });

    setActiveTab({ id: 'tab-log', filePath: '/p/file.js' });
    seedDetection({
      tabId: 'tab-log',
      rows: [{ name: 'lodash', status: 'detected' }],
      cwdHasPackageJson: true,
    });
    render(<DependenciesPanel />);

    fireEvent.click(screen.getByTestId('dependency-install-lodash'));
    await new Promise((r) => setTimeout(r, 600));

    expect(logHandler).not.toBeNull();
    const runId = useDependencyDetectionStore
      .getState()
      .installByTab.get('tab-log')?.runId;
    expect(runId).toBeTruthy();

    act(() => {
      logHandler!({
        runId: runId!,
        stream: 'stdout',
        chunk: 'npm WARN deprecated foo@1.0.0\n',
      });
    });

    await waitFor(() => {
      const out = screen.getByTestId('dependencies-install-log-output');
      expect(out.textContent).toMatch(/npm WARN deprecated/u);
    });
  });

  it('reopens a hidden log surface when the next install starts', async () => {
    let logHandler: ((event: DependencyInstallLogEvent) => void) | null = null;
    const installResolvers: Array<(value: DependencyInstallResult) => void> = [];
    installMockBridge({
      installJs: vi.fn(
        () =>
          new Promise<DependencyInstallResult>((resolve) => {
            installResolvers.push(resolve);
          })
      ),
      onInstallLogJs: vi.fn(
        (handler: (event: DependencyInstallLogEvent) => void) => {
          logHandler = handler;
          return () => {};
        }
      ),
    });

    setActiveTab({ id: 'tab-log-reopen', filePath: '/p/file.js' });
    seedDetection({
      tabId: 'tab-log-reopen',
      rows: [
        { name: 'lodash', status: 'detected' },
        { name: 'date-fns', status: 'detected' },
      ],
      cwdHasPackageJson: true,
    });
    render(<DependenciesPanel />);

    fireEvent.click(screen.getByTestId('dependency-install-lodash'));
    await new Promise((r) => setTimeout(r, 600));
    const firstRunId = useDependencyDetectionStore
      .getState()
      .installByTab.get('tab-log-reopen')?.runId;
    act(() => {
      logHandler!({
        runId: firstRunId!,
        stream: 'stdout',
        chunk: 'added lodash\n',
      });
      installResolvers[0]!({
        statuses: { lodash: 'installed' },
        outcome: 'success',
        failureReason: null,
        cwd: '/p',
        exitCode: 0,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('dependencies-install-log-dismiss')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('dependencies-install-log-dismiss'));
    await waitFor(() => {
      expect(
        screen.queryByTestId('dependencies-install-log-output')
      ).toBeNull();
    });

    fireEvent.click(screen.getByTestId('dependency-install-date-fns'));
    await new Promise((r) => setTimeout(r, 600));

    await waitFor(() => {
      expect(screen.getByTestId('dependencies-install-cancel')).toBeTruthy();
      expect(screen.getByTestId('dependencies-install-log-output')).toBeTruthy();
    });
  });

  it('renders the cancel button in Spanish tuteo under ES locale', async () => {
    installMockBridge({
      installJs: vi.fn(
        () => new Promise<DependencyInstallResult>(() => {})
      ),
    });
    await i18next.changeLanguage('es');
    try {
      setActiveTab({ id: 'tab-es', filePath: '/p/file.js' });
      seedDetection({
        tabId: 'tab-es',
        rows: [{ name: 'lodash', status: 'detected' }],
        cwdHasPackageJson: true,
      });
      render(<DependenciesPanel />);

      fireEvent.click(screen.getByTestId('dependency-install-lodash'));
      await new Promise((r) => setTimeout(r, 600));

      await waitFor(() => {
        const cancel = screen.getByTestId('dependencies-install-cancel');
        expect(cancel.textContent).toMatch(/Cancela/u);
      });
    } finally {
      await i18next.changeLanguage('en');
    }
  });
});
