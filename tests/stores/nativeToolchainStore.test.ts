import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetNativeToolchainStoreForTests,
  useNativeToolchainStore,
} from '../../src/renderer/stores/nativeToolchainStore';
import { resetNativeProbeCacheForTests } from '../../src/renderer/utils/nativeProbeCache';

vi.mock('../../src/renderer/runners/env', () => ({
  resolveUserEnvForNativeProbe: () => ({ PATH: '/opt/bin' }),
}));

const originalLingua = window.lingua;

function installShell(platform: string, rust: Record<string, unknown>) {
  Object.defineProperty(window, 'lingua', { configurable: true, value: { platform, rust } });
}

describe('native toolchain store', () => {
  beforeEach(() => {
    resetNativeToolchainStoreForTests();
    resetNativeProbeCacheForTests();
  });

  afterEach(() => {
    Object.defineProperty(window, 'lingua', { configurable: true, value: originalLingua });
  });

  it('keeps the searched folders only while the binary is missing', () => {
    const { report } = useNativeToolchainStore.getState();
    report('go', { installed: false, reason: 'missing', searched: ['/usr/local/go/bin'] });
    expect(useNativeToolchainStore.getState().go).toEqual({ status: 'missing', searched: ['/usr/local/go/bin'] });
    report('go', { installed: false, reason: 'check-failed', searched: ['/usr/local/go/bin'] });
    expect(useNativeToolchainStore.getState().go).toEqual({ status: 'check-failed', searched: [] });
  });

  it('shares one probe between concurrent callers and refreshes on demand', async () => {
    let finish: (value: unknown) => void = () => {};
    const detect = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    installShell('darwin', { detect });
    const first = useNativeToolchainStore.getState().probe('rust');
    const second = useNativeToolchainStore.getState().probe('rust');
    finish({ installed: false, reason: 'missing', searched: ['~/.cargo/bin'] });
    expect(await Promise.all([first, second])).toEqual(['missing', 'missing']);
    expect(detect).toHaveBeenCalledOnce();
    expect(detect).toHaveBeenCalledWith({ PATH: '/opt/bin' });

    detect.mockResolvedValueOnce({ installed: true });
    expect(await useNativeToolchainStore.getState().probe('rust', { refresh: true })).toBe('installed');
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('treats a rejected probe as a failed check, not a missing binary', async () => {
    installShell('darwin', { detect: vi.fn().mockRejectedValue(new Error('ipc gone')) });
    expect(await useNativeToolchainStore.getState().probe('rust')).toBe('check-failed');
  });

  it('never probes the host or opens a picker in the browser', async () => {
    const detect = vi.fn();
    const chooseBinary = vi.fn();
    installShell('web', { detect, chooseBinary });
    expect(await useNativeToolchainStore.getState().probe('rust')).toBe('checking');
    expect(await useNativeToolchainStore.getState().choose('rust')).toEqual({ status: 'canceled' });
    expect(detect).not.toHaveBeenCalled();
    expect(chooseBinary).not.toHaveBeenCalled();
  });

  it('reports a pick main could not finish instead of throwing', async () => {
    installShell('darwin', { detect: vi.fn(), chooseBinary: vi.fn().mockRejectedValue(new Error('EACCES')) });
    expect(await useNativeToolchainStore.getState().choose('rust')).toEqual({ status: 'failed' });
  });

  it('detects again after a binary is saved, and not after a refused one', async () => {
    const detect = vi.fn().mockResolvedValue({ installed: true, version: 'rustc 1.90.0' });
    const chooseBinary = vi
      .fn()
      .mockResolvedValueOnce({ status: 'invalid', reason: 'wrong-name' })
      .mockResolvedValueOnce({ status: 'saved', version: 'rustc 1.90.0' });
    installShell('darwin', { detect, chooseBinary });
    useNativeToolchainStore.getState().report('rust', { installed: false, reason: 'missing' });

    expect(await useNativeToolchainStore.getState().choose('rust')).toEqual({ status: 'invalid', reason: 'wrong-name' });
    expect(detect).not.toHaveBeenCalled();
    expect(await useNativeToolchainStore.getState().choose('rust')).toMatchObject({ status: 'saved' });
    expect(detect).toHaveBeenCalledOnce();
    expect(useNativeToolchainStore.getState().rust.status).toBe('installed');
  });
});
