import { describe, expect, it, vi } from 'vitest';
import { findMatchingGlobalShortcut } from '@/hooks/globalShortcutModel';

function keydown(init: KeyboardEventInit & { key: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', { cancelable: true, ...init });
}

describe('findMatchingGlobalShortcut', () => {
  it('resolves catalog defaults and user overrides', () => {
    const canDispatchDebugger = vi.fn(() => true);

    expect(
      findMatchingGlobalShortcut(keydown({ key: 'b', ctrlKey: true }), {}, canDispatchDebugger)?.id
    ).toBe('view-toggle-sidebar');

    const overrides = {
      'view-toggle-sidebar': [{ tokens: ['Mod', 'Shift', 'U'] }],
    } as const;
    expect(
      findMatchingGlobalShortcut(
        keydown({ key: 'u', ctrlKey: true, shiftKey: true }),
        overrides,
        canDispatchDebugger
      )?.id
    ).toBe('view-toggle-sidebar');
    expect(
      findMatchingGlobalShortcut(keydown({ key: 'b', ctrlKey: true }), overrides, canDispatchDebugger)
    ).toBeNull();
  });

  it('leaves Escape to the overlay-aware hook path', () => {
    expect(findMatchingGlobalShortcut(keydown({ key: 'Escape' }), {}, () => true)).toBeNull();
  });

  it('skips debugger matches rejected by the runtime gate', () => {
    const canDispatchDebugger = vi.fn(() => false);

    expect(findMatchingGlobalShortcut(keydown({ key: 'F10' }), {}, canDispatchDebugger)).toBeNull();
    expect(canDispatchDebugger).toHaveBeenCalledWith('debugger-step-over');
  });

  it('skips catalog matches without a registered action', () => {
    expect(
      findMatchingGlobalShortcut(
        keydown({ key: 'b', ctrlKey: true }),
        {},
        () => true,
        () => false
      )
    ).toBeNull();
  });
});
