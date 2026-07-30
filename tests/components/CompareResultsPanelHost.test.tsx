import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompareResultsPanelHost } from '@/components/Editor/CompareResultsPanelHost';
import type { CompareResultsPanelProps } from '@/components/Editor/CompareResultsPanel';
import { initI18n } from '@/i18n';

const mocks = vi.hoisted(() => ({
  loadPanel: vi.fn(),
}));

vi.mock('@/components/Editor/compareResultsPanelLoader', () => ({
  loadCompareResultsPanel: mocks.loadPanel,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function PanelProbe({ language }: CompareResultsPanelProps) {
  return <div data-testid="compare-panel-probe">{language}</div>;
}

describe('CompareResultsPanelHost', () => {
  beforeEach(() => {
    initI18n('en');
    mocks.loadPanel.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows immediate feedback and renders the loaded panel under StrictMode', async () => {
    const pending = deferred<{ CompareResultsPanel: typeof PanelProbe }>();
    mocks.loadPanel.mockReturnValue(pending.promise);

    const { rerender } = render(
      <StrictMode>
        <CompareResultsPanelHost language="javascript" />
      </StrictMode>
    );

    expect(screen.getByTestId('compare-results-panel-loading').textContent).toContain(
      'Loading comparison'
    );
    rerender(
      <StrictMode>
        <CompareResultsPanelHost language="typescript" />
      </StrictMode>
    );

    await act(async () => {
      pending.resolve({ CompareResultsPanel: PanelProbe });
    });

    expect((await screen.findByTestId('compare-panel-probe')).textContent).toBe('typescript');
  });

  it('surfaces a localized failure with an honest reload action', async () => {
    const error = new Error('comparison chunk unavailable');
    mocks.loadPanel.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<CompareResultsPanelHost language="javascript" />);

    expect((await screen.findByTestId('compare-results-panel-load-failed')).textContent).toContain(
      'Comparison could not load'
    );
    expect(consoleError).toHaveBeenCalledWith(
      '[compare] failed to load the comparison panel',
      error
    );
    expect(screen.getByRole('button', { name: 'Reload Lingua' })).toBeTruthy();
    expect(mocks.loadPanel).toHaveBeenCalledTimes(1);
  });

  it('ignores a late module result after the comparison is closed', async () => {
    const pending = deferred<{ CompareResultsPanel: typeof PanelProbe }>();
    mocks.loadPanel.mockReturnValue(pending.promise);
    const { unmount } = render(<CompareResultsPanelHost language="javascript" />);

    unmount();
    await act(async () => {
      pending.resolve({ CompareResultsPanel: PanelProbe });
    });

    expect(screen.queryByTestId('compare-panel-probe')).toBeNull();
  });
});
