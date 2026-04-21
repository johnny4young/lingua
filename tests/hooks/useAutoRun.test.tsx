import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoRun, AUTO_RUN_DEBOUNCE_MS } from '@/hooks/useAutoRun';
import { runnerManager } from '@/runners';
import { useEditorStore } from '@/stores/editorStore';
import { useLicenseStore } from '@/stores/licenseStore';
import { useResultStore } from '@/stores/resultStore';

vi.mock('@/runners', () => ({
  runnerManager: {
    prepareRunner: vi.fn(),
    isSupported: vi.fn(),
    needsInitialization: vi.fn(),
    stop: vi.fn(),
  },
}));

describe('useAutoRun', () => {
  const initialEditor = useEditorStore.getState();
  const initialLicense = useLicenseStore.getState();
  const initialResult = useResultStore.getState();
  const originalLingua = window.lingua;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useEditorStore.setState(initialEditor, true);
    useLicenseStore.setState(initialLicense, true);
    useLicenseStore.setState({
      token: 'test.token',
      status: {
        kind: 'active',
        verification: {
          ok: true,
          state: 'active',
          supportWindowEndsAt: Date.now() + 86_400_000,
          payload: {
            productId: 'lingua-desktop',
            tier: 'pro',
            issuedTo: 'test@example.com',
            issuedAt: new Date().toISOString(),
            supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
            entitlements: [],
          },
        },
      },
      lastVerifiedAt: Date.now(),
    });
    useResultStore.setState(initialResult, true);
    vi.mocked(runnerManager.isSupported).mockReturnValue(true);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    useEditorStore.setState(initialEditor, true);
    useLicenseStore.setState(initialLicense, true);
    useResultStore.setState(initialResult, true);
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: originalLingua,
    });
  });

  it('does not auto-run desktop-only languages on the web build (RL-038 Slice C)', async () => {
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: { platform: 'web' },
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-go',
          name: 'main.go',
          language: 'go',
          content: 'package main\nfunc main() {}\n',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-go',
    });
    useResultStore.setState({
      fullOutput: 'stale output',
      executionSource: 'auto',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });

    expect(runnerManager.prepareRunner).not.toHaveBeenCalled();
    expect(useResultStore.getState().fullOutput).toBe('');
    expect(useResultStore.getState().executionSource).toBeNull();
  });

  it('still auto-runs desktop-only languages on the desktop build', async () => {
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: { platform: 'darwin' },
    });
    vi.mocked(runnerManager.prepareRunner).mockResolvedValue({
      runner: {
        execute: vi.fn().mockResolvedValue({
          stdout: [{ type: 'log', args: ['ok'] }],
          stderr: [],
          result: undefined,
          executionTime: 12,
          error: null,
        }),
      },
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-go',
          name: 'main.go',
          language: 'go',
          content: 'package main\nfunc main() {}\n',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-go',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });

    expect(runnerManager.prepareRunner).toHaveBeenCalledWith('go');
    expect(useResultStore.getState().executionSource).toBe('auto');
  });
});
