import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareLinkController } from '@/components/Share/ShareLinkController';
import { initI18n } from '@/i18n';
import { _resetCommandBusForTesting, emitCommand } from '@/stores/commandBus';
import type { ShareLinkFlowProps } from '@/components/Share/ShareLinkFlow';

const mocks = vi.hoisted(() => ({
  loadFlow: vi.fn(),
  pushErrorNotice: vi.fn(),
}));

vi.mock('@/components/Share/shareLinkFlowLoader', () => ({
  loadShareLinkFlow: mocks.loadFlow,
}));

vi.mock('@/hooks/useStatusNotice', () => ({
  useStatusNotice: () => ({
    error: mocks.pushErrorNotice,
  }),
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

function FlowProbe({ trigger, onClose }: ShareLinkFlowProps) {
  return (
    <div data-testid="share-link-flow">
      <span data-testid="share-link-trigger">{trigger}</span>
      <button type="button" onClick={onClose}>
        Close flow
      </button>
    </div>
  );
}

describe('ShareLinkController lazy flow', () => {
  beforeEach(() => {
    initI18n('en');
    mocks.loadFlow.mockReset();
    mocks.pushErrorNotice.mockReset();
  });

  afterEach(() => {
    cleanup();
    _resetCommandBusForTesting();
    vi.restoreAllMocks();
  });

  it('loads on the first command, deduplicates pending triggers, and reuses the flow', async () => {
    const pending = deferred<{ ShareLinkFlow: typeof FlowProbe }>();
    mocks.loadFlow.mockReturnValue(pending.promise);
    render(
      <StrictMode>
        <ShareLinkController />
      </StrictMode>
    );

    expect(mocks.loadFlow).not.toHaveBeenCalled();
    expect(screen.queryByTestId('share-link-loading-dialog')).toBeNull();

    act(() => {
      emitCommand('share.trigger', { trigger: 'button' });
    });
    expect(screen.getByTestId('share-link-loading-dialog')).toBeTruthy();
    expect(mocks.loadFlow).toHaveBeenCalledTimes(1);

    act(() => {
      emitCommand('share.trigger', { trigger: 'shortcut' });
    });
    expect(mocks.loadFlow).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ ShareLinkFlow: FlowProbe });
    });
    expect(await screen.findByTestId('share-link-flow')).toBeTruthy();
    expect(screen.getByTestId('share-link-trigger').textContent).toBe('button');

    act(() => {
      screen.getByRole('button', { name: 'Close flow' }).click();
      emitCommand('share.trigger', { trigger: 'palette' });
    });
    expect(await screen.findByTestId('share-link-flow')).toBeTruthy();
    expect(screen.getByTestId('share-link-trigger').textContent).toBe('palette');
    expect(mocks.loadFlow).toHaveBeenCalledTimes(1);
  });

  it('lets the user close the loading shell while preserving the pending module', async () => {
    const pending = deferred<{ ShareLinkFlow: typeof FlowProbe }>();
    mocks.loadFlow.mockReturnValue(pending.promise);
    render(<ShareLinkController />);

    act(() => {
      emitCommand('share.trigger', { trigger: 'button' });
    });
    act(() => {
      screen.getByRole('button', { name: 'Cancel' }).click();
    });
    expect(screen.queryByTestId('share-link-loading-dialog')).toBeNull();

    await act(async () => {
      pending.resolve({ ShareLinkFlow: FlowProbe });
    });
    act(() => {
      emitCommand('share.trigger', { trigger: 'shortcut' });
    });
    expect(await screen.findByTestId('share-link-flow')).toBeTruthy();
    expect(screen.getByTestId('share-link-trigger').textContent).toBe('shortcut');
    expect(mocks.loadFlow).toHaveBeenCalledTimes(1);
  });

  it('closes a failed request, surfaces a localized notice, and allows retry', async () => {
    const error = new Error('share chunk unavailable');
    mocks.loadFlow.mockRejectedValueOnce(error).mockResolvedValueOnce({ ShareLinkFlow: FlowProbe });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<ShareLinkController />);

    act(() => {
      emitCommand('share.trigger', { trigger: 'button' });
    });
    await waitFor(() => {
      expect(mocks.pushErrorNotice).toHaveBeenCalledWith('share.notice.loadFailed');
    });
    expect(consoleError).toHaveBeenCalledWith('[share] failed to load the share-link flow', error);
    expect(screen.queryByTestId('share-link-loading-dialog')).toBeNull();

    act(() => {
      emitCommand('share.trigger', { trigger: 'shortcut' });
    });
    expect(await screen.findByTestId('share-link-flow')).toBeTruthy();
    expect(mocks.loadFlow).toHaveBeenCalledTimes(2);
  });
});
