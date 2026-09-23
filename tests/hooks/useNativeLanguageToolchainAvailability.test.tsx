import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNativeLanguageToolchainAvailability } from '../../src/renderer/hooks/useNativeLanguageToolchainAvailability';

vi.mock('../../src/renderer/runners/env', () => ({
  resolveUserEnvForNativeProbe: (mode: string, platform: string) => ({
    PATH: '/opt/toolchains/bin',
    ...(platform === 'win32' ? { PATHEXT: '.EXE;.CMD' } : {}),
    ...(mode === 'go' ? { GOPATH: '/tmp/go-path' } : { CARGO_HOME: '/tmp/cargo-home' }),
  }),
}));

const originalLingua = window.lingua;

function installShell(platform: string, go: ReturnType<typeof vi.fn>, rust: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window, 'lingua', {
    configurable: true,
    value: { platform, go: { detect: go }, rust: { detect: rust } },
  });
}

describe('native Go and Rust availability', () => {
  afterEach(() => {
    Object.defineProperty(window, 'lingua', { configurable: true, value: originalLingua });
  });

  it('distinguishes an installed toolchain, a missing binary and a failed probe', async () => {
    const go = vi.fn().mockResolvedValue({ installed: false, reason: 'missing' });
    const rust = vi.fn().mockResolvedValue({ installed: false, reason: 'check-failed' });
    installShell('darwin', go, rust);
    const { result, rerender } = renderHook(({ open }) => useNativeLanguageToolchainAvailability(open), {
      initialProps: { open: true },
    });
    await waitFor(() => expect(result.current).toEqual({ go: 'missing', rust: 'check-failed' }));
    expect(go).toHaveBeenCalledWith({ PATH: '/opt/toolchains/bin', GOPATH: '/tmp/go-path' });
    expect(rust).toHaveBeenCalledWith({ PATH: '/opt/toolchains/bin', CARGO_HOME: '/tmp/cargo-home' });

    rust.mockResolvedValue({ installed: true });
    rerender({ open: false });
    rerender({ open: true });
    await waitFor(() => expect(result.current).toEqual({ go: 'missing', rust: 'installed' }));
  });

  it('does not probe the host in the browser or publish a late result after close', async () => {
    const go = vi.fn();
    const rust = vi.fn();
    installShell('web', go, rust);
    renderHook(() => useNativeLanguageToolchainAvailability(true));
    expect(go).not.toHaveBeenCalled();
    expect(rust).not.toHaveBeenCalled();

    let finishGo: (value: { installed: boolean }) => void = () => {};
    go.mockReturnValue(new Promise(resolve => { finishGo = resolve; }));
    rust.mockResolvedValue({ installed: true });
    installShell('darwin', go, rust);
    const { result, rerender } = renderHook(({ open }) => useNativeLanguageToolchainAvailability(open), {
      initialProps: { open: true },
    });
    rerender({ open: false });
    await act(async () => finishGo({ installed: false }));
    expect(result.current.go).toBe('checking');
  });

  it('keeps Windows discovery keys but not unrelated user variables', async () => {
    const go = vi.fn().mockResolvedValue({ installed: true });
    const rust = vi.fn().mockResolvedValue({ installed: true });
    installShell('win32', go, rust);
    renderHook(() => useNativeLanguageToolchainAvailability(true));
    await waitFor(() => expect(go).toHaveBeenCalledOnce());
    expect(go).toHaveBeenCalledWith({
      PATH: '/opt/toolchains/bin', PATHEXT: '.EXE;.CMD', GOPATH: '/tmp/go-path',
    });
    expect(rust).toHaveBeenCalledWith({
      PATH: '/opt/toolchains/bin', PATHEXT: '.EXE;.CMD', CARGO_HOME: '/tmp/cargo-home',
    });
  });
});
