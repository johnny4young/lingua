import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecentRunsPopoverHost } from '@/components/Editor/RecentRunsPopoverHost';
import type { RecentRunsPopoverProps } from '@/components/Editor/recentRunsPopoverLoader';
import type { ExecutionHistoryEntry } from '@/stores/executionHistoryStore';
import { initI18n } from '@/i18n';

const mocks = vi.hoisted(() => ({
  loadPopover: vi.fn(),
}));

vi.mock('@/components/Editor/recentRunsPopoverLoader', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/components/Editor/recentRunsPopoverLoader')>();
  return {
    ...actual,
    loadRecentRunsPopover: mocks.loadPopover,
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeEntry(id: string): ExecutionHistoryEntry {
  return {
    id,
    tabId: 'tab-js',
    language: 'javascript',
    status: 'ok',
    durationMs: 1,
    timestamp: 100,
    snapshot: null,
  };
}

function PopoverProbe({ entries }: RecentRunsPopoverProps) {
  return (
    <div data-testid="recent-runs-popover-probe">{entries.map(entry => entry.id).join(',')}</div>
  );
}

describe('RecentRunsPopoverHost', () => {
  beforeEach(() => {
    initI18n('en');
    mocks.loadPopover.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows immediate feedback and renders the loaded popover with current entries', async () => {
    const pending = deferred<{ RecentRunsPopover: typeof PopoverProbe }>();
    mocks.loadPopover.mockReturnValue(pending.promise);
    const onClose = vi.fn();
    const { rerender } = render(
      <StrictMode>
        <RecentRunsPopoverHost entries={[makeEntry('run-1')]} onClose={onClose} />
      </StrictMode>
    );

    expect(screen.getByTestId('recent-runs-popover-loading').textContent).toContain(
      'Loading recent runs'
    );

    rerender(
      <StrictMode>
        <RecentRunsPopoverHost
          entries={[makeEntry('run-2'), makeEntry('run-1')]}
          onClose={onClose}
        />
      </StrictMode>
    );
    await act(async () => {
      pending.resolve({ RecentRunsPopover: PopoverProbe });
    });

    expect((await screen.findByTestId('recent-runs-popover-probe')).textContent).toBe(
      'run-2,run-1'
    );
  });

  it('surfaces a localized failure with an honest reload action', async () => {
    const error = new Error('Recent Runs chunk unavailable');
    mocks.loadPopover.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<RecentRunsPopoverHost entries={[makeEntry('run-1')]} onClose={vi.fn()} />);

    expect((await screen.findByTestId('recent-runs-popover-load-failed')).textContent).toContain(
      'Recent runs could not load'
    );
    expect(consoleError).toHaveBeenCalledWith(
      '[execution-history] failed to load the Recent Runs popover',
      error
    );
    expect(screen.getByRole('button', { name: 'Reload Lingua' })).toBeTruthy();
  });

  it('ignores a late module result after the popover closes', async () => {
    const pending = deferred<{ RecentRunsPopover: typeof PopoverProbe }>();
    mocks.loadPopover.mockReturnValue(pending.promise);
    const { unmount } = render(
      <RecentRunsPopoverHost entries={[makeEntry('run-1')]} onClose={vi.fn()} />
    );

    unmount();
    await act(async () => {
      pending.resolve({ RecentRunsPopover: PopoverProbe });
    });

    expect(screen.queryByTestId('recent-runs-popover-probe')).toBeNull();
  });
});
