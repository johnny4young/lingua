import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRunLedgerTap } from '@/hooks/useRunLedgerTap';
import { useExecutionHistoryStore } from '@/stores/executionHistoryStore';
import { useSettingsStore } from '@/stores/settingsStore';

const ledger = vi.hoisted(() => ({
  loaded: vi.fn(),
  recordRun: vi.fn(),
}));

vi.mock('@/runtime/runLedger', () => {
  ledger.loaded();
  return { recordRun: ledger.recordRun };
});

describe('useRunLedgerTap', () => {
  const initialSettings = useSettingsStore.getState();

  beforeEach(() => {
    ledger.loaded.mockClear();
    ledger.recordRun.mockClear();
    useExecutionHistoryStore.setState({ entries: [] });
    useSettingsStore.setState(initialSettings, true);
    useSettingsStore.setState({ runLedgerEnabled: false });
  });

  it('loads the ledger only for new runs recorded after opt-in', async () => {
    renderHook(() => useRunLedgerTap());

    act(() => {
      useExecutionHistoryStore.getState().record({
        language: 'javascript',
        status: 'ok',
        durationMs: 5,
        timestamp: 1_700_000_000_000,
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ledger.loaded).not.toHaveBeenCalled();
    expect(ledger.recordRun).not.toHaveBeenCalled();

    useSettingsStore.setState({ runLedgerEnabled: true });
    act(() => {
      useExecutionHistoryStore.getState().record({
        language: 'python',
        status: 'error',
        durationMs: 12,
        timestamp: 1_700_000_001_000,
        tabId: 'tab-python',
      });
    });

    await vi.waitFor(() => {
      expect(ledger.loaded).toHaveBeenCalledTimes(1);
      expect(ledger.recordRun).toHaveBeenCalledWith({
        language: 'python',
        status: 'error',
        durationMs: 12,
        startedAtMs: 1_700_000_001_000,
        tabId: 'tab-python',
        code: null,
        contentHash: null,
        capsule: null,
      });
    });

    act(() => {
      useExecutionHistoryStore.getState().record({
        language: 'ruby',
        status: 'ok',
        durationMs: 8,
        timestamp: 1_700_000_002_000,
      });
    });
    await vi.waitFor(() => {
      expect(ledger.recordRun).toHaveBeenCalledTimes(2);
    });
    expect(ledger.loaded).toHaveBeenCalledTimes(1);
  });
});
