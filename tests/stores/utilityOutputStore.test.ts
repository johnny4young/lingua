import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useRegisterUtilityApply,
  useRegisterUtilityOutput,
} from '@/hooks/useRegisterUtilityOutput';
import { useUtilityOutputStore } from '@/stores/utilityOutputStore';

afterEach(() => {
  // Reset between tests so a leaked provider doesn't bleed into the
  // next case. The store has no built-in reset, so we clear directly.
  useUtilityOutputStore.getState().clearProvider();
  useUtilityOutputStore.getState().clearApplyHandler();
});

describe('utilityOutputStore', () => {
  it('starts with no registered provider', () => {
    expect(useUtilityOutputStore.getState().getProvider()).toBeNull();
  });

  it('setProvider stores the getter and getProvider returns it', () => {
    const provider = () => 'sample output';
    act(() => {
      useUtilityOutputStore.getState().setProvider(provider);
    });
    const got = useUtilityOutputStore.getState().getProvider();
    expect(got).toBe(provider);
    expect(got?.()).toBe('sample output');
  });

  it('clearProvider resets the getter to null', () => {
    act(() => {
      useUtilityOutputStore.getState().setProvider(() => 'x');
      useUtilityOutputStore.getState().clearProvider();
    });
    expect(useUtilityOutputStore.getState().getProvider()).toBeNull();
  });
});

describe('useRegisterUtilityOutput', () => {
  it('registers the provider on mount and clears on unmount', () => {
    const provider = () => 'panel output';
    const { unmount } = renderHook(() => useRegisterUtilityOutput(provider));

    expect(useUtilityOutputStore.getState().getProvider()).toBe(provider);

    unmount();

    expect(useUtilityOutputStore.getState().getProvider()).toBeNull();
  });

  it('last-mounted panel wins (sibling registration replaces predecessor)', () => {
    const first = () => 'first';
    const second = () => 'second';

    const a = renderHook(() => useRegisterUtilityOutput(first));
    expect(useUtilityOutputStore.getState().getProvider()?.()).toBe('first');

    const b = renderHook(() => useRegisterUtilityOutput(second));
    expect(useUtilityOutputStore.getState().getProvider()?.()).toBe('second');

    // Unmount the second one — the first should not auto-restore (the
    // store doesn't keep a stack), so getProvider becomes null. This
    // is intentional for implementation: only one panel is mounted at a time
    // inside the modal, so a second concurrent registration is a test
    // edge case rather than a real production scenario.
    b.unmount();
    expect(useUtilityOutputStore.getState().getProvider()).toBeNull();

    a.unmount();
  });

  it('does not clear a sibling panel that took over registration', () => {
    // Race the lifecycle: panel A mounts (registers), panel B mounts
    // (overwrites the provider), then panel A unmounts. A's cleanup
    // should NOT clear B's registration because the active provider
    // is no longer A's getter.
    const aGetter = () => 'A';
    const bGetter = () => 'B';

    const a = renderHook(() => useRegisterUtilityOutput(aGetter));
    const b = renderHook(() => useRegisterUtilityOutput(bGetter));

    expect(useUtilityOutputStore.getState().getProvider()).toBe(bGetter);

    a.unmount();

    // B is still active. A's cleanup detected the active provider was
    // not its own getter and did nothing.
    expect(useUtilityOutputStore.getState().getProvider()).toBe(bGetter);

    b.unmount();
  });

  it('re-running the hook with the same provider keeps the registration intact', () => {
    const stable = () => 'stable';
    const { rerender } = renderHook(
      ({ p }: { p: () => string | null }) => useRegisterUtilityOutput(p),
      { initialProps: { p: stable } }
    );

    rerender({ p: stable });
    expect(useUtilityOutputStore.getState().getProvider()).toBe(stable);
  });
});

describe('useRegisterUtilityApply ', () => {
  it('starts with no registered apply handler', () => {
    expect(useUtilityOutputStore.getState().getApplyHandler()).toBeNull();
  });

  it('registers an apply descriptor and clears it on unmount', () => {
    const run = vi.fn();
    const handler = () => ({ enabled: true, toolNameKey: 'utilities.tool.json.titleLabel', run });
    const { unmount } = renderHook(() => useRegisterUtilityApply(handler));

    const got = useUtilityOutputStore.getState().getApplyHandler();
    expect(got).toBe(handler);
    const descriptor = got?.();
    expect(descriptor?.enabled).toBe(true);
    descriptor?.run();
    expect(run).toHaveBeenCalledTimes(1);

    unmount();
    expect(useUtilityOutputStore.getState().getApplyHandler()).toBeNull();
  });

  it('does not clear a sibling apply handler that took over', () => {
    const aRun = vi.fn();
    const bRun = vi.fn();
    const a = () => ({ enabled: true, toolNameKey: 'a', run: aRun });
    const b = () => ({ enabled: true, toolNameKey: 'b', run: bRun });

    const aHandle = renderHook(() => useRegisterUtilityApply(a));
    const bHandle = renderHook(() => useRegisterUtilityApply(b));
    expect(useUtilityOutputStore.getState().getApplyHandler()).toBe(b);

    aHandle.unmount();
    // Cleanup should not have cleared B because the active handler is
    // not A's reference. Same pattern as the output-provider test.
    expect(useUtilityOutputStore.getState().getApplyHandler()).toBe(b);

    bHandle.unmount();
  });
});
