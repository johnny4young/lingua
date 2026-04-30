/**
 * RL-061 Slice 5 — pin the web-update polling hook contract.
 *
 * Covers the two interlocking behaviours that drive the banner:
 *   1. Periodic poll on the 12-hour interval, plus an immediate
 *      poll on mount.
 *   2. `visibilitychange` re-poll when the tab returns from
 *      hidden after >1 hour idle.
 *   3. Desktop short-circuit — native `window.lingua.platform`
 *      values never fetch (the native autoupdater handles updates).
 *
 * `vi.useFakeTimers()` is required so we can advance the
 * `setInterval` deterministically without sleeping the test.
 */

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useWebVersionPolling,
  WEB_VERSION_POLL_INTERVAL_MS,
} from '@/hooks/useWebVersionPolling';

// `vi.mock` is hoisted; the path has to be a literal. Keep aligned
// with the dynamic imports in this file.
vi.mock('@/services/webUpdateServer', () => ({
  fetchLatestWebVersion: vi.fn(),
}));

function HookProbe({ onState }: { onState: (state: ReturnType<typeof useWebVersionPolling>) => void }) {
  const state = useWebVersionPolling();
  onState(state);
  return null;
}

beforeEach(async () => {
  vi.useFakeTimers();
  // Ensure jsdom looks like a web build (no `window.lingua`).
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'lingua');
  const mod = await import('@/services/webUpdateServer');
  vi.mocked(mod.fetchLatestWebVersion).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'lingua');
});

describe('useWebVersionPolling', () => {
  it('fires an immediate poll on mount and reflects the result', async () => {
    const mod = await import('@/services/webUpdateServer');
    vi.mocked(mod.fetchLatestWebVersion).mockResolvedValue({ version: '0.3.0' });

    let captured: ReturnType<typeof useWebVersionPolling> | null = null;
    render(<HookProbe onState={(s) => { captured = s; }} />);

    // Run the microtask + the immediate poll without advancing the
    // 12-hour interval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mod.fetchLatestWebVersion).toHaveBeenCalledTimes(1);
    expect(captured?.remoteVersion).toBe('0.3.0');
  });

  it('re-polls every 12 hours', async () => {
    const mod = await import('@/services/webUpdateServer');
    vi.mocked(mod.fetchLatestWebVersion).mockResolvedValue({ version: '0.3.0' });

    render(<HookProbe onState={() => {}} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mod.fetchLatestWebVersion).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WEB_VERSION_POLL_INTERVAL_MS);
    });
    expect(mod.fetchLatestWebVersion).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WEB_VERSION_POLL_INTERVAL_MS);
    });
    expect(mod.fetchLatestWebVersion).toHaveBeenCalledTimes(3);
  });

  it('keeps the last successful version when a later poll fails', async () => {
    const mod = await import('@/services/webUpdateServer');
    vi.mocked(mod.fetchLatestWebVersion)
      .mockResolvedValueOnce({ version: '0.3.0' })
      .mockResolvedValueOnce(null);

    let captured: ReturnType<typeof useWebVersionPolling> | null = null;
    render(<HookProbe onState={(s) => { captured = s; }} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(captured?.remoteVersion).toBe('0.3.0');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WEB_VERSION_POLL_INTERVAL_MS);
    });
    expect(mod.fetchLatestWebVersion).toHaveBeenCalledTimes(2);
    expect(captured?.remoteVersion).toBe('0.3.0');
  });

  it('re-polls on visibilitychange when the last poll was over 1 hour ago', async () => {
    const mod = await import('@/services/webUpdateServer');
    vi.mocked(mod.fetchLatestWebVersion).mockResolvedValue({ version: '0.3.0' });

    render(<HookProbe onState={() => {}} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mod.fetchLatestWebVersion).toHaveBeenCalledTimes(1);

    // Advance > 1 hour but < 12 hours so the interval doesn't fire,
    // then dispatch visibilitychange.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    });

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mod.fetchLatestWebVersion).toHaveBeenCalledTimes(2);
  });

  it('does NOT re-poll on visibilitychange when the last poll was recent', async () => {
    const mod = await import('@/services/webUpdateServer');
    vi.mocked(mod.fetchLatestWebVersion).mockResolvedValue({ version: '0.3.0' });

    render(<HookProbe onState={() => {}} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mod.fetchLatestWebVersion).toHaveBeenCalledTimes(1);

    // Less than 1 hour passes — visibility change should NOT trigger.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mod.fetchLatestWebVersion).toHaveBeenCalledTimes(1);
  });

  it('does NOT poll in desktop builds (native window.lingua platform)', async () => {
    const mod = await import('@/services/webUpdateServer');
    vi.mocked(mod.fetchLatestWebVersion).mockResolvedValue({ version: '0.3.0' });

    Object.defineProperty(window, 'lingua', {
      value: { platform: 'darwin', license: {}, format: {} },
      configurable: true,
      writable: true,
    });

    render(<HookProbe onState={() => {}} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WEB_VERSION_POLL_INTERVAL_MS * 3);
    });

    expect(mod.fetchLatestWebVersion).not.toHaveBeenCalled();
  });

  it('polls in browser builds even though the web adapter defines window.lingua', async () => {
    const mod = await import('@/services/webUpdateServer');
    vi.mocked(mod.fetchLatestWebVersion).mockResolvedValue({ version: '0.3.0' });

    Object.defineProperty(window, 'lingua', {
      value: { platform: 'web', license: {}, format: {} },
      configurable: true,
      writable: true,
    });

    render(<HookProbe onState={() => {}} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mod.fetchLatestWebVersion).toHaveBeenCalledTimes(1);
  });

  it('cleans up the interval and listener on unmount', async () => {
    const mod = await import('@/services/webUpdateServer');
    vi.mocked(mod.fetchLatestWebVersion).mockResolvedValue({ version: '0.3.0' });

    const { unmount } = render(<HookProbe onState={() => {}} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mod.fetchLatestWebVersion).toHaveBeenCalledTimes(1);

    unmount();

    // Advance past two intervals — no further calls because the
    // unmount cleared the interval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WEB_VERSION_POLL_INTERVAL_MS * 2);
    });
    expect(mod.fetchLatestWebVersion).toHaveBeenCalledTimes(1);
  });
});
