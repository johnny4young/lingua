import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNativeJsRuntimeAvailability } from '../../src/renderer/hooks/useNativeJsRuntimeAvailability';
import { useUIStore } from '../../src/renderer/stores/uiStore';

vi.mock('../../src/renderer/runners/env', () => ({
  resolveUserEnvForRunner: () => ({}),
}));

const originalLingua = window.lingua;

function installShell(platform: string, detect: Record<'node' | 'deno' | 'bun', ReturnType<typeof vi.fn>>) {
  Object.defineProperty(window, 'lingua', {
    configurable: true,
    value: {
      platform,
      openExternal: vi.fn().mockResolvedValue(true),
      node: { detect: detect.node },
      deno: { detect: detect.deno },
      bun: { detect: detect.bun },
    },
  });
}

describe('native JS runtime availability', () => {
  beforeEach(() => {
    useUIStore.setState({ statusNotice: null });
  });

  afterEach(() => {
    Object.defineProperty(window, 'lingua', { configurable: true, value: originalLingua });
  });

  it('distinguishes installed, missing and failed probes and retries a missing binary', async () => {
    const detect = {
      node: vi.fn().mockResolvedValueOnce({ installed: false }).mockResolvedValue({ installed: true }),
      deno: vi.fn().mockResolvedValue({ installed: true }),
      bun: vi.fn().mockRejectedValue(new Error('probe failed')),
    };
    installShell('darwin', detect);
    const { result } = renderHook(() => useNativeJsRuntimeAvailability(true));
    await waitFor(() => expect(result.current.availability).toEqual({
      node: 'missing', deno: 'installed', bun: 'check-failed',
    }));
    expect(detect.node).toHaveBeenCalledWith({}, true);
    act(() => result.current.recoverMissing('node'));
    const retry = useUIStore.getState().statusNotice?.actions?.[1];
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('nativeToolchain.missing.message');
    act(() => {
      useUIStore.getState().dismissStatusNotice('cta');
      retry?.onClick();
    });
    await waitFor(() => {
      expect(result.current.availability.node).toBe('installed');
      expect(useUIStore.getState().statusNotice?.messageKey).toBe('nativeToolchain.retry.detected');
    });
  });

  it('never probes a web host', async () => {
    const detect = { node: vi.fn(), deno: vi.fn(), bun: vi.fn() };
    installShell('web', detect);
    renderHook(() => useNativeJsRuntimeAvailability(true));
    expect(detect.node).not.toHaveBeenCalled();
    expect(detect.deno).not.toHaveBeenCalled();
    expect(detect.bun).not.toHaveBeenCalled();
  });

  it('ignores a detector result after the picker closes', async () => {
    let finishNode: (value: { installed: boolean }) => void = () => {};
    const detect = {
      node: vi.fn().mockReturnValue(new Promise(resolve => { finishNode = resolve; })),
      deno: vi.fn().mockResolvedValue({ installed: true }),
      bun: vi.fn().mockResolvedValue({ installed: true }),
    };
    installShell('darwin', detect);
    const { result, rerender } = renderHook(({ open }) => useNativeJsRuntimeAvailability(open), {
      initialProps: { open: true },
    });
    rerender({ open: false });
    await act(async () => finishNode({ installed: false }));
    expect(result.current.availability.node).toBe('checking');
  });
});
