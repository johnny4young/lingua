import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTransformUtilityPanel } from '../../../src/renderer/components/DeveloperUtilities/useTransformUtilityPanel';
import { useUtilityOutputStore } from '../../../src/renderer/stores/utilityOutputStore';

describe('useTransformUtilityPanel', () => {
  beforeEach(() => {
    useUtilityOutputStore.getState().clearProvider();
  });

  it('owns input, derives output, and publishes only valid non-empty results', () => {
    const transform = vi.fn((input: string) => ({
      output: input === 'bad' ? 'stale' : input.toUpperCase(),
      errorKey: input === 'bad' ? 'utilities.status.invalid' : null,
    }));
    const { result } = renderHook(() =>
      useTransformUtilityPanel({ utilityId: 'base64', initialInput: 'lingua', transform })
    );

    expect(result.current).toMatchObject({ input: 'lingua', output: 'LINGUA', errorKey: null });
    expect(useUtilityOutputStore.getState().getProvider()?.()).toBe('LINGUA');

    act(() => result.current.setInput('bad'));
    expect(result.current).toMatchObject({
      input: 'bad',
      output: 'stale',
      errorKey: 'utilities.status.invalid',
    });
    expect(useUtilityOutputStore.getState().getProvider()?.()).toBeNull();

    act(() => result.current.setInput(''));
    expect(useUtilityOutputStore.getState().getProvider()?.()).toBeNull();
    expect(transform).toHaveBeenLastCalledWith('');
  });

  it('clears its output provider when the panel unmounts', () => {
    const { unmount } = renderHook(() =>
      useTransformUtilityPanel({
        utilityId: 'url',
        initialInput: 'value',
        transform: input => ({ output: input, errorKey: null }),
      })
    );

    expect(useUtilityOutputStore.getState().getProvider()?.()).toBe('value');
    unmount();
    expect(useUtilityOutputStore.getState().getProvider()).toBeNull();
  });
});
