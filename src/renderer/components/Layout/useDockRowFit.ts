import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Row steps in order: tab glyphs give way first, then the controls' labels, and last the tab labels
 * fold to their glyphs (RunMeter.css, testsDock.css, debugger.css).
 */
const DOCK_ROW_FIT_STEPS = ['full', 'labels', 'tight', 'glyphs'] as const;
const COMPACT_STEPS = ['glyphs'] as const;

/**
 * Sets `data-fit` on the tab row to the first step at which its tab list stops scrolling, and
 * returns whether the tabs read as glyphs only. It measures the row itself, so the meter column
 * or the explorer beside the dock never skews it. A compact dock starts at glyphs.
 */
export function useDockRowFit(
  rowRef: RefObject<HTMLElement | null>,
  listRef: RefObject<HTMLElement | null>,
  compact: boolean
): boolean {
  const [glyphsOnly, setGlyphsOnly] = useState(compact);
  useLayoutEffect(() => {
    const row = rowRef.current;
    const list = listRef.current;
    if (!row || !list) return;
    const steps = compact ? COMPACT_STEPS : DOCK_ROW_FIT_STEPS;
    const fit = () => {
      for (const step of steps) {
        row.dataset.fit = step;
        if (list.scrollWidth <= list.clientWidth) break;
      }
      setGlyphsOnly(row.dataset.fit === 'glyphs');
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    // Only size changes refit: the row's width, each tab (a label or badge that widens it) and the controls.
    // The refit waits a frame: changing sizes inside the callback raises a ResizeObserver loop error.
    let frame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    const observe = () => {
      for (const node of [row, ...Array.from(row.children), ...Array.from(list.children)]) resize.observe(node);
    };
    observe();
    // A tab that appears or goes away.
    const mutation = new MutationObserver(() => {
      observe();
      fit();
    });
    mutation.observe(list, { childList: true });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
    };
  }, [rowRef, listRef, compact]);
  return glyphsOnly;
}
