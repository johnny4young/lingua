import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineResultWidgetsHost } from '@/components/Editor/InlineResultWidgetsHost';
import type { InlineResultWidgetsProps } from '@/components/Editor/inlineResultWidgetsLoader';

const mocks = vi.hoisted(() => ({
  loadWidgets: vi.fn(),
  pushErrorNotice: vi.fn(),
}));

vi.mock('@/components/Editor/inlineResultWidgetsLoader', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/components/Editor/inlineResultWidgetsLoader')>();
  return {
    ...actual,
    loadInlineResultWidgets: mocks.loadWidgets,
  };
});

vi.mock('@/hooks/useStatusNotice', () => ({
  useStatusNotice: () => ({
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: mocks.pushErrorNotice,
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function WidgetsProbe({ lineResults, lineTimings = [], tabId }: InlineResultWidgetsProps) {
  return (
    <span data-testid="inline-result-widgets-probe">
      {tabId}:{lineResults.length}:{lineTimings.length}
    </span>
  );
}

function makeProps(overrides: Partial<InlineResultWidgetsProps> = {}): InlineResultWidgetsProps {
  return {
    editor: null,
    monaco: null,
    lineResults: [],
    lineTimings: [],
    tabId: 'tab-1',
    ...overrides,
  };
}

describe('InlineResultWidgetsHost', () => {
  beforeEach(() => {
    mocks.loadWidgets.mockReset();
    mocks.pushErrorNotice.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('does not load the overlay runtime before execution produces display data', () => {
    render(<InlineResultWidgetsHost {...makeProps()} />);

    expect(mocks.loadWidgets).not.toHaveBeenCalled();
    expect(screen.queryByTestId('inline-result-widgets-probe')).toBeNull();
  });

  it('loads on the first visible result and forwards current props under StrictMode', async () => {
    mocks.loadWidgets.mockResolvedValue({ InlineResultWidgets: WidgetsProbe });
    const { rerender } = render(
      <StrictMode>
        <InlineResultWidgetsHost
          {...makeProps({
            lineResults: [{ line: 1, value: '42', type: 'result' }],
          })}
        />
      </StrictMode>
    );

    expect((await screen.findByTestId('inline-result-widgets-probe')).textContent).toBe(
      'tab-1:1:0'
    );

    rerender(
      <StrictMode>
        <InlineResultWidgetsHost
          {...makeProps({
            tabId: 'tab-2',
            lineResults: [{ line: 3, value: 'ready', type: 'watch' }],
            lineTimings: [{ line: 3, durationMs: 1.2 }],
          })}
        />
      </StrictMode>
    );

    expect(screen.getByTestId('inline-result-widgets-probe').textContent).toBe('tab-2:1:1');
    expect(mocks.loadWidgets).toHaveBeenCalledTimes(2);
  });

  it('also activates for a timing-only run', async () => {
    mocks.loadWidgets.mockResolvedValue({ InlineResultWidgets: WidgetsProbe });

    render(
      <InlineResultWidgetsHost {...makeProps({ lineTimings: [{ line: 2, durationMs: 8.4 }] })} />
    );

    expect((await screen.findByTestId('inline-result-widgets-probe')).textContent).toBe(
      'tab-1:0:1'
    );
  });

  it('reports a failed overlay chunk once and does not retry in the same document', async () => {
    const error = new Error('inline result chunk unavailable');
    mocks.loadWidgets.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const props = makeProps({
      lineResults: [{ line: 1, value: '42', type: 'result' }],
    });

    const { rerender } = render(<InlineResultWidgetsHost {...props} />);
    await act(async () => undefined);
    rerender(<InlineResultWidgetsHost {...props} />);

    expect(consoleError).toHaveBeenCalledWith(
      '[inline-results] failed to load the Monaco overlay',
      error
    );
    expect(mocks.pushErrorNotice).toHaveBeenCalledWith('results.inline.loadFailed');
    expect(mocks.loadWidgets).toHaveBeenCalledTimes(1);
  });

  it('ignores a late module result after unmount', async () => {
    const pending = deferred<{ InlineResultWidgets: typeof WidgetsProbe }>();
    mocks.loadWidgets.mockReturnValue(pending.promise);
    const { unmount } = render(
      <InlineResultWidgetsHost
        {...makeProps({
          lineResults: [{ line: 1, value: '42', type: 'result' }],
        })}
      />
    );

    unmount();
    await act(async () => {
      pending.resolve({ InlineResultWidgets: WidgetsProbe });
    });

    expect(screen.queryByTestId('inline-result-widgets-probe')).toBeNull();
  });
});
