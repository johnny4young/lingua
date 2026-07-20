/**
 * implementation Slice E implementation note — desktop native `.linguanb` save via the
 * capability sandbox. Pins the saveDialog → write → revokeRoot flow and
 * the web-fallback signal (`'unavailable'` when no desktop bridge is
 * available, including the web FSA shim).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  saveLinguanbViaCapability,
  saveOrDownloadLinguanb,
} from '../../src/renderer/runtime/notebookLinguanbDisk';

const originalLingua = (globalThis as { lingua?: unknown }).lingua;

function setFsBridge(fs: unknown, platform = 'darwin'): void {
  (globalThis as { lingua?: unknown }).lingua = fs ? { platform, fs } : undefined;
}

afterEach(() => {
  (globalThis as { lingua?: unknown }).lingua = originalLingua;
  vi.restoreAllMocks();
});

describe('saveLinguanbViaCapability', () => {
  it('returns "unavailable" when there is no desktop fs bridge (web)', async () => {
    setFsBridge(undefined);
    expect(await saveLinguanbViaCapability('{}', 'nb.linguanb')).toBe('unavailable');
  });

  it('returns "unavailable" for the web fs shim so callers use the blob fallback', async () => {
    const saveDialog = vi.fn();
    setFsBridge({ saveDialog, write: vi.fn(), revokeRoot: vi.fn() }, 'web');
    expect(await saveLinguanbViaCapability('{}', 'nb.linguanb')).toBe('unavailable');
    expect(saveDialog).not.toHaveBeenCalled();
  });

  it('saves through saveDialog + write, then revokes the minted capability', async () => {
    const write = vi.fn().mockResolvedValue(true);
    const revokeRoot = vi.fn().mockResolvedValue(true);
    const saveDialog = vi.fn().mockResolvedValue({
      canceled: false,
      rootId: 'root-1',
      rootPath: '/tmp',
      fileRelativePath: 'nb.linguanb',
    });
    setFsBridge({ saveDialog, write, revokeRoot });
    const outcome = await saveLinguanbViaCapability('{"format":"linguanb"}', 'nb.linguanb');
    expect(outcome).toBe('saved');
    expect(write).toHaveBeenCalledWith('root-1', 'nb.linguanb', '{"format":"linguanb"}');
    expect(revokeRoot).toHaveBeenCalledWith('root-1');
  });

  it('returns "canceled" when the dialog is dismissed (no write)', async () => {
    const write = vi.fn();
    const saveDialog = vi.fn().mockResolvedValue({ canceled: true });
    setFsBridge({ saveDialog, write, revokeRoot: vi.fn() });
    expect(await saveLinguanbViaCapability('{}', 'nb.linguanb')).toBe('canceled');
    expect(write).not.toHaveBeenCalled();
  });

  it('returns "error" when the save dialog blocks the chosen path', async () => {
    const write = vi.fn();
    const saveDialog = vi
      .fn()
      .mockResolvedValue({ canceled: true, blockedFamily: 'credentials' });
    setFsBridge({ saveDialog, write, revokeRoot: vi.fn() });
    expect(await saveLinguanbViaCapability('{}', 'nb.linguanb')).toBe('error');
    expect(write).not.toHaveBeenCalled();
  });

  it('returns "error" when the write fails + still revokes the capability', async () => {
    const revokeRoot = vi.fn().mockResolvedValue(true);
    const saveDialog = vi.fn().mockResolvedValue({
      canceled: false,
      rootId: 'root-2',
      rootPath: '/tmp',
      fileRelativePath: 'nb.linguanb',
    });
    setFsBridge({ saveDialog, write: vi.fn().mockResolvedValue(false), revokeRoot });
    expect(await saveLinguanbViaCapability('{}', 'nb.linguanb')).toBe('error');
    expect(revokeRoot).toHaveBeenCalledWith('root-2');
  });
});

describe('saveOrDownloadLinguanb', () => {
  it('routes a desktop "saved" outcome to onOk (no error, no blob download)', async () => {
    const write = vi.fn().mockResolvedValue(true);
    const saveDialog = vi.fn().mockResolvedValue({
      canceled: false,
      rootId: 'root-1',
      rootPath: '/tmp',
      fileRelativePath: 'nb.linguanb',
    });
    setFsBridge({ saveDialog, write, revokeRoot: vi.fn().mockResolvedValue(true) });
    const createObjectURL = vi.fn(() => 'blob:mock');
    (URL as unknown as { createObjectURL: () => string }).createObjectURL =
      createObjectURL;
    const onOk = vi.fn();
    const onError = vi.fn();
    await saveOrDownloadLinguanb('{"format":"linguanb"}', 'nb.linguanb', {
      onOk,
      onError,
    });
    expect(onOk).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    // The desktop save path must NOT fall through to the blob download.
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('treats a "canceled" outcome as a silent no-op (neither handler fires)', async () => {
    const saveDialog = vi.fn().mockResolvedValue({ canceled: true });
    setFsBridge({ saveDialog, write: vi.fn(), revokeRoot: vi.fn() });
    const onOk = vi.fn();
    const onError = vi.fn();
    await saveOrDownloadLinguanb('{}', 'nb.linguanb', { onOk, onError });
    expect(onOk).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('routes a desktop "error" outcome to onError', async () => {
    const saveDialog = vi.fn().mockResolvedValue({
      canceled: false,
      rootId: 'root-1',
      rootPath: '/tmp',
      fileRelativePath: 'nb.linguanb',
    });
    setFsBridge({
      saveDialog,
      write: vi.fn().mockResolvedValue(false),
      revokeRoot: vi.fn().mockResolvedValue(true),
    });
    const onOk = vi.fn();
    const onError = vi.fn();
    await saveOrDownloadLinguanb('{}', 'nb.linguanb', { onOk, onError });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onOk).not.toHaveBeenCalled();
  });

  it('falls back to the blob download on web ("unavailable") and reports onOk', async () => {
    setFsBridge(undefined); // no desktop bridge → 'unavailable'
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: () => string }).createObjectURL =
      createObjectURL;
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL =
      revokeObjectURL;
    const onOk = vi.fn();
    const onError = vi.fn();
    await saveOrDownloadLinguanb('{"format":"linguanb"}', 'nb.linguanb', {
      onOk,
      onError,
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(onOk).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('routes a thrown blob download to onError', async () => {
    setFsBridge(undefined);
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => {
      throw new Error('blob unavailable');
    };
    const onOk = vi.fn();
    const onError = vi.fn();
    await saveOrDownloadLinguanb('{}', 'nb.linguanb', { onOk, onError });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onOk).not.toHaveBeenCalled();
  });
});
