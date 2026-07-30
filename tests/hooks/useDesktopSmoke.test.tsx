import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDesktopSmoke } from '@/hooks/useDesktopSmoke';

const runner = vi.hoisted(() => ({
  loaded: vi.fn(),
  run: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/hooks/desktopSmokeRunner', () => {
  runner.loaded();
  return { runDesktopSmoke: runner.run };
});

describe('useDesktopSmoke', () => {
  const originalLingua = window.lingua;

  afterEach(() => {
    window.lingua = originalLingua;
    vi.restoreAllMocks();
    runner.run.mockReset();
  });

  it('loads once after enablement and reports a harness startup failure', async () => {
    runner.run.mockResolvedValue(undefined);
    const hook = renderHook(({ enabled }: { enabled: boolean }) => useDesktopSmoke(enabled), {
      initialProps: { enabled: false },
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(runner.loaded).not.toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalled();

    hook.rerender({ enabled: true });
    await vi.waitFor(() => {
      expect(runner.loaded).toHaveBeenCalledTimes(1);
      expect(runner.run).toHaveBeenCalledTimes(1);
    });

    hook.rerender({ enabled: false });
    hook.rerender({ enabled: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(runner.run).toHaveBeenCalledTimes(1);

    const finish = vi.fn();
    window.lingua = {
      desktopSmoke: { finish },
    } as typeof window.lingua;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runner.run.mockRejectedValueOnce(new Error('smoke chunk unavailable'));

    renderHook(() => useDesktopSmoke(true));
    await vi.waitFor(() => {
      expect(finish).toHaveBeenCalledWith(false);
    });
    expect(consoleError).toHaveBeenCalledWith(
      '[desktop-smoke] failed to load or start the renderer harness',
      expect.objectContaining({ message: 'smoke chunk unavailable' })
    );
  });
});
