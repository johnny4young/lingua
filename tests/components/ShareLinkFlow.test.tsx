import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareLinkFlow } from '@/components/Share/ShareLinkFlow';
import { initI18n } from '@/i18n';
import { useUIStore } from '@/stores/uiStore';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  write: vi.fn(),
  track: vi.fn(),
}));

vi.mock('@/hooks/useActiveTab', () => ({
  useActiveTab: () => ({
    id: 'share-tab',
    name: 'share.js',
    language: 'javascript',
    content: 'console.log("share")',
    workflowMode: 'scratchpad',
    runtimeMode: 'worker',
    autoLogEnabled: false,
  }),
}));

vi.mock('@/utils/shareLink', () => ({
  bucketShareSize: () => 'small',
  prepareShareLinkFromTab: (...args: unknown[]) => mocks.prepare(...args),
  shareCreateStatusFromPrepareReason: (reason: string) =>
    reason === 'unknown-language' ? 'unknown-language' : 'too-large',
  trackShareCreated: (...args: unknown[]) => mocks.track(...args),
  writeShareLinkToClipboard: (...args: unknown[]) => mocks.write(...args),
}));

const preparedLink = {
  url: 'https://app.linguacode.dev/#share=v1.demo',
  fragment: 'share=v1.demo',
  sizeBytes: 128,
  payload: {
    version: 1 as const,
    tab: { name: 'share.js', language: 'javascript' },
    source: { content: 'console.log("share")' },
    modes: {},
    input: {},
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function FlowHarness() {
  const [open, setOpen] = useState(true);
  return open ? (
    <ShareLinkFlow trigger="button" onClose={() => setOpen(false)} />
  ) : (
    <div data-testid="flow-closed" />
  );
}

describe('ShareLinkFlow', () => {
  beforeEach(() => {
    initI18n('en');
    useUIStore.setState({ statusNotice: null });
    mocks.prepare.mockReset().mockResolvedValue({ ok: true, link: preparedLink });
    mocks.write.mockReset().mockResolvedValue({ ok: true });
    mocks.track.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps the confirmed clipboard write non-cancellable and reports success once', async () => {
    const pendingWrite = deferred<{ ok: true }>();
    mocks.write.mockReturnValue(pendingWrite.promise);
    render(<FlowHarness />);

    expect(await screen.findByTestId('share-confirm-modal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('share-confirm-confirm'));

    expect(screen.getByTestId('share-link-loading-dialog')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(mocks.write).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingWrite.resolve({ ok: true });
    });
    expect(await screen.findByTestId('flow-closed')).toBeTruthy();
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('share.notice.copied');
    expect(mocks.track).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'button', status: 'success' })
    );
  });

  it('cancels safely while preparation is pending and ignores its later result', async () => {
    const pendingPrepare = deferred<{ ok: true; link: typeof preparedLink }>();
    mocks.prepare.mockReturnValue(pendingPrepare.promise);
    render(<FlowHarness />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByTestId('flow-closed')).toBeTruthy();

    await act(async () => {
      pendingPrepare.resolve({ ok: true, link: preparedLink });
    });
    expect(screen.queryByTestId('share-confirm-modal')).toBeNull();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('turns an unexpected preparation rejection into a retryable warning', async () => {
    const error = new Error('compression unavailable');
    mocks.prepare.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<FlowHarness />);

    expect(await screen.findByTestId('flow-closed')).toBeTruthy();
    expect(consoleError).toHaveBeenCalledWith('[share] failed to prepare a share link', error);
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'warning',
      messageKey: 'share.notice.prepareFailed',
    });
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('preserves the existing too-large notice and terminal telemetry', async () => {
    mocks.prepare.mockResolvedValue({
      ok: false,
      reason: 'fragment-too-large',
      sizeBytes: 9000,
    });
    render(<FlowHarness />);

    await waitFor(() => {
      expect(screen.getByTestId('flow-closed')).toBeTruthy();
    });
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'warning',
      messageKey: 'share.notice.tooLarge',
    });
    expect(mocks.track).toHaveBeenCalledWith({
      trigger: 'button',
      status: 'too-large',
      sizeBucket: 'small',
    });
  });
});
