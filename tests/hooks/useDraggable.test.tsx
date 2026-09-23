import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDraggable } from '@/hooks/useDraggable';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useDraggable measured surface', () => {
  it('clamps to the rendered width without resetting a moved position when the hint changes', () => {
    const element = document.createElement('div');
    const elementRef = { current: element };
    let measuredWidth = 300;
    let notifyResize: (() => void) | null = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          notifyResize = () => callback([], this as ResizeObserver);
        }
        observe() {}
        disconnect() {}
      }
    );
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          width: measuredWidth,
          height: 42,
        }) as DOMRect
    );
    const viewportWidth = window.innerWidth;
    const maxX = viewportWidth - 300 - 8;

    const { result, rerender } = renderHook(
      ({ hint, resetSignal }) =>
        useDraggable({
          storageKey: null,
          defaultPosition: { x: viewportWidth, y: 40 },
          size: { width: hint, height: 42 },
          elementRef,
          viewportMargin: 8,
          resetSignal,
        }),
      { initialProps: { hint: 100, resetSignal: 0 } }
    );

    expect(result.current.position.x).toBe(maxX);
    act(() => result.current.setPosition({ x: 400, y: 40 }));
    expect(result.current.position.x).toBe(400);

    measuredWidth = 700;
    act(() => notifyResize?.());
    expect(result.current.position.x).toBe(viewportWidth - 700 - 8);
    measuredWidth = 300;
    act(() => notifyResize?.());
    act(() => result.current.setPosition({ x: 400, y: 40 }));

    rerender({ hint: 500, resetSignal: 0 });
    expect(result.current.position.x).toBe(400);

    rerender({ hint: 500, resetSignal: 1 });
    expect(result.current.position.x).toBe(maxX);

    const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    try {
      act(() => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 });
        window.dispatchEvent(new Event('resize'));
      });
      expect(result.current.position.x).toBe(292);
    } finally {
      if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor);
      else delete (window as { innerWidth?: number }).innerWidth;
    }
  });
});
