import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunCapsuleV1 } from '@/../shared/runCapsule';
import { RunCapsuleExportButtonHost } from '@/components/Editor/RunCapsuleExportButtonHost';
import type { RunCapsuleExportButtonProps } from '@/components/Editor/runCapsuleExportLoader';
import { FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';

const mocks = vi.hoisted(() => ({
  capsule: { current: null as RunCapsuleV1 | null },
  loadButton: vi.fn(),
  pushErrorNotice: vi.fn(),
}));

vi.mock('@/components/Editor/runCapsuleExportLoader', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/components/Editor/runCapsuleExportLoader')>();
  return {
    ...actual,
    loadRunCapsuleExportButton: mocks.loadButton,
  };
});

vi.mock('@/stores/executionHistoryStore', () => ({
  useExecutionHistoryStore: (
    selector: (state: { latestCapsule: () => RunCapsuleV1 | null }) => unknown
  ) => selector({ latestCapsule: () => mocks.capsule.current }),
}));

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

function ExportButtonProbe({ capsule }: RunCapsuleExportButtonProps) {
  return <button data-testid="run-capsule-export-probe">{capsule.tab.language}</button>;
}

describe('RunCapsuleExportButtonHost', () => {
  beforeEach(() => {
    mocks.capsule.current = null;
    mocks.loadButton.mockReset();
    mocks.pushErrorNotice.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('does not load or advertise export before a capsule exists', () => {
    render(<RunCapsuleExportButtonHost />);

    expect(mocks.loadButton).not.toHaveBeenCalled();
    expect(screen.queryByTestId('run-capsule-export-probe')).toBeNull();
  });

  it('passes the current capsule to the loaded control under StrictMode', async () => {
    mocks.capsule.current = FIXTURE_MINIMAL_JS;
    mocks.loadButton.mockResolvedValue({ RunCapsuleExportButton: ExportButtonProbe });

    render(
      <StrictMode>
        <RunCapsuleExportButtonHost />
      </StrictMode>
    );

    expect((await screen.findByTestId('run-capsule-export-probe')).textContent).toBe('javascript');
    // React deliberately re-runs mount effects in StrictMode. The production
    // loader absorbs these two calls into one cached module promise.
    expect(mocks.loadButton).toHaveBeenCalledTimes(2);
  });

  it('reports a failed control chunk and does not retry in the same document', async () => {
    const error = new Error('export control chunk unavailable');
    mocks.capsule.current = FIXTURE_MINIMAL_JS;
    mocks.loadButton.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { rerender } = render(<RunCapsuleExportButtonHost />);
    await act(async () => undefined);
    rerender(<RunCapsuleExportButtonHost />);

    expect(consoleError).toHaveBeenCalledWith(
      '[run-capsule] failed to load the export control',
      error
    );
    expect(mocks.pushErrorNotice).toHaveBeenCalledWith('results.actions.exportCapsule.loadFailed');
    expect(mocks.loadButton).toHaveBeenCalledTimes(1);
  });

  it('ignores a late module result after unmount', async () => {
    const pending = deferred<{ RunCapsuleExportButton: typeof ExportButtonProbe }>();
    mocks.capsule.current = FIXTURE_MINIMAL_JS;
    mocks.loadButton.mockReturnValue(pending.promise);
    const { unmount } = render(<RunCapsuleExportButtonHost />);

    unmount();
    await act(async () => {
      pending.resolve({ RunCapsuleExportButton: ExportButtonProbe });
    });

    expect(screen.queryByTestId('run-capsule-export-probe')).toBeNull();
  });
});
