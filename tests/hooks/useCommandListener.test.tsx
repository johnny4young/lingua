import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, type PropsWithChildren } from 'react';
import { useCommandListener } from '@/hooks/useCommandListener';
import { _resetCommandBusForTesting, emitCommand } from '@/stores/commandBus';

describe('useCommandListener', () => {
  afterEach(() => {
    _resetCommandBusForTesting();
  });

  it('uses the latest callback and detaches on unmount', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ listener }) => useCommandListener('settings.navigate', listener),
      { initialProps: { listener: first } }
    );

    emitCommand('settings.navigate', { tab: 'privacy' });
    rerender({ listener: second });
    emitCommand('settings.navigate', { tab: 'account' });
    unmount();
    emitCommand('settings.navigate', { tab: 'general' });

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('keeps exactly one live subscription through StrictMode remounts', () => {
    const listener = vi.fn();
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
    const { unmount } = renderHook(() => useCommandListener('overlay.openSnippets', listener), {
      wrapper,
    });

    emitCommand('overlay.openSnippets');
    expect(listener).toHaveBeenCalledOnce();

    unmount();
    emitCommand('overlay.openSnippets');
    expect(listener).toHaveBeenCalledOnce();
  });
});
