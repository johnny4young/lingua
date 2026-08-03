import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunCapsuleV1 } from '@/../shared/runCapsule';
import type { UseGlobalShortcutsOptions } from '@/hooks/useGlobalShortcuts';
import { useAppShortcuts, type AppShortcutDeps } from '@/hooks/useAppShortcuts';
import { FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';

const mocks = vi.hoisted(() => ({
  registeredOptions: null as UseGlobalShortcutsOptions | null,
  capsule: { current: null as RunCapsuleV1 | null },
  loadExporter: vi.fn(),
  pushInfoNotice: vi.fn(),
  pushSuccessNotice: vi.fn(),
  pushWarningNotice: vi.fn(),
}));

vi.mock('@/hooks/useGlobalShortcuts', () => ({
  useGlobalShortcuts: (options: UseGlobalShortcutsOptions) => {
    mocks.registeredOptions = options;
  },
}));

vi.mock('@/stores/executionHistoryStore', () => ({
  useExecutionHistoryStore: {
    getState: () => ({
      latestCapsule: () => mocks.capsule.current,
    }),
  },
}));

vi.mock('@/components/Editor/runCapsuleExportLoader', () => ({
  loadCapsuleExporter: mocks.loadExporter,
}));

vi.mock('@/utils/statusNotice', () => ({
  pushInfoNotice: mocks.pushInfoNotice,
  pushSuccessNotice: mocks.pushSuccessNotice,
  pushWarningNotice: mocks.pushWarningNotice,
}));

function makeDeps(overrides: Partial<AppShortcutDeps> = {}): AppShortcutDeps {
  return {
    isRunning: false,
    run: vi.fn(),
    stop: vi.fn(),
    saveActiveTab: vi.fn(),
    saveActiveTabAs: vi.fn(),
    openFileFromDisk: vi.fn(),
    activeTabId: null,
    closeTab: vi.fn(async () => true),
    toggleSidebar: vi.fn(),
    toggleConsole: vi.fn(),
    overlay: 'none',
    toggleOverlay: vi.fn(),
    closeOverlay: vi.fn(),
    openOverlay: vi.fn(),
    handleOpenDeveloperUtility: vi.fn(),
    exportProjectBundle: vi.fn(),
    ...overrides,
  };
}

function registeredOptions(): UseGlobalShortcutsOptions {
  if (!mocks.registeredOptions) {
    throw new Error('useAppShortcuts did not register global shortcut options');
  }
  return mocks.registeredOptions;
}

describe('useAppShortcuts', () => {
  beforeEach(() => {
    mocks.registeredOptions = null;
    mocks.capsule.current = null;
    mocks.loadExporter.mockReset();
    mocks.pushInfoNotice.mockReset();
    mocks.pushSuccessNotice.mockReset();
    mocks.pushWarningNotice.mockReset();
  });

  it('mounts and registers the global shortcut payload', () => {
    const { unmount } = renderHook(() => useAppShortcuts(makeDeps()));

    expect(registeredOptions().run).toBeTypeOf('function');
    expect(() => unmount()).not.toThrow();
  });

  it('routes the Recipes shortcut through the single App overlay slot', () => {
    const openOverlay = vi.fn();
    const { unmount } = renderHook(() => useAppShortcuts(makeDeps({ openOverlay })));

    registeredOptions().openRecipesOverlay();

    expect(openOverlay).toHaveBeenCalledWith('recipes');
    unmount();
  });

  it('keeps the exporter unloaded when the shortcut has no capsule', () => {
    renderHook(() => useAppShortcuts(makeDeps()));

    registeredOptions().exportLatestCapsule();

    expect(mocks.loadExporter).not.toHaveBeenCalled();
    expect(mocks.pushInfoNotice).toHaveBeenCalledWith('results.actions.exportCapsule.noCapsule');
  });

  it('loads the exporter on demand and reports success', async () => {
    const exportCapsuleToClipboard = vi.fn().mockResolvedValue({ ok: true, json: '{}' });
    mocks.capsule.current = FIXTURE_MINIMAL_JS;
    mocks.loadExporter.mockResolvedValue({ exportCapsuleToClipboard });
    renderHook(() => useAppShortcuts(makeDeps()));

    registeredOptions().exportLatestCapsule();
    await act(async () => undefined);

    expect(mocks.loadExporter).toHaveBeenCalledTimes(1);
    expect(exportCapsuleToClipboard).toHaveBeenCalledWith(
      FIXTURE_MINIMAL_JS,
      'result-panel-export'
    );
    expect(mocks.pushSuccessNotice).toHaveBeenCalledWith(
      'settings.account.runCapsules.copiedNotice'
    );
  });

  it('surfaces a failed exporter chunk through localized recovery copy', async () => {
    const error = new Error('export pipeline unavailable');
    mocks.capsule.current = FIXTURE_MINIMAL_JS;
    mocks.loadExporter.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderHook(() => useAppShortcuts(makeDeps()));

    registeredOptions().exportLatestCapsule();
    await act(async () => undefined);

    expect(consoleError).toHaveBeenCalledWith(
      '[run-capsule] failed to load the export pipeline',
      error
    );
    expect(mocks.pushWarningNotice).toHaveBeenCalledWith(
      'results.actions.exportCapsule.loadFailed'
    );
  });
});
