import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { useShareLinkBoot } from '@/hooks/useShareLinkBoot';

const mocks = vi.hoisted(() => ({
  importHash: vi.fn(),
  loadImport: vi.fn(),
  pushErrorNotice: vi.fn(),
}));

vi.mock('@/hooks/shareLinkImportLoader', () => ({
  loadShareLinkImport: mocks.loadImport,
}));

vi.mock('@/hooks/useStatusNotice', () => ({
  useStatusNotice: () => ({
    error: mocks.pushErrorNotice,
  }),
}));

vi.mock('@/utils/safeBoot', () => ({
  isSafeMode: () => false,
}));

function setHash(hash: string): void {
  window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
}

function fireHashChange(hash: string): void {
  const oldURL = window.location.href;
  setHash(hash);
  window.dispatchEvent(
    new HashChangeEvent('hashchange', {
      oldURL,
      newURL: window.location.href,
    })
  );
}

describe('useShareLinkBoot lazy importer', () => {
  beforeEach(() => {
    initI18n('en');
    setHash('');
    mocks.importHash.mockReset().mockResolvedValue(undefined);
    mocks.loadImport.mockReset().mockResolvedValue({
      importShareLinkHash: mocks.importHash,
    });
    mocks.pushErrorNotice.mockReset();
  });

  afterEach(() => {
    cleanup();
    setHash('');
    vi.restoreAllMocks();
  });

  it('keeps the importer unloaded for empty and foreign hashes', async () => {
    const { unmount } = renderHook(() => useShareLinkBoot());
    await act(async () => Promise.resolve());
    expect(mocks.loadImport).not.toHaveBeenCalled();
    unmount();

    setHash('#settings');
    renderHook(() => useShareLinkBoot());
    await act(async () => Promise.resolve());
    expect(mocks.loadImport).not.toHaveBeenCalled();
  });

  it('loads once for a matching hash and deduplicates the same pending fragment', async () => {
    let resolveLoad!: (value: { importShareLinkHash: typeof mocks.importHash }) => void;
    const pending = new Promise<{ importShareLinkHash: typeof mocks.importHash }>(resolve => {
      resolveLoad = resolve;
    });
    mocks.loadImport.mockReturnValue(pending);
    setHash('#share=v1.pending');
    renderHook(() => useShareLinkBoot());

    act(() => {
      fireHashChange('#share=v1.pending');
    });
    expect(mocks.loadImport).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveLoad({ importShareLinkHash: mocks.importHash });
    });
    expect(mocks.importHash).toHaveBeenCalledWith('share=v1.pending');
    expect(mocks.importHash).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed chunk and retries the preserved hash on remount', async () => {
    const error = new Error('import chunk unavailable');
    mocks.loadImport
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ importShareLinkHash: mocks.importHash });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setHash('#share=v1.retry');

    const first = renderHook(() => useShareLinkBoot());
    await waitFor(() => {
      expect(mocks.pushErrorNotice).toHaveBeenCalledWith('share.notice.loadFailed');
    });
    expect(consoleError).toHaveBeenCalledWith(
      '[share] failed to load the share-link importer',
      error
    );
    expect(window.location.hash).toBe('#share=v1.retry');
    first.unmount();

    renderHook(() => useShareLinkBoot());
    await waitFor(() => {
      expect(mocks.importHash).toHaveBeenCalledWith('share=v1.retry');
    });
    expect(mocks.loadImport).toHaveBeenCalledTimes(2);
  });
});
