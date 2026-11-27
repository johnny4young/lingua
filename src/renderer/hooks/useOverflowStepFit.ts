import { useLayoutEffect, useState, type RefObject } from 'react';

const NO_FLOOR = () => 0;

/**
 * The first of `stepCount` steps at which the row stops overflowing. `content` is whatever changes
 * its natural width; `floorFor(width)` is the lowest step a width may take and must be stable.
 */
export function useOverflowStepFit(
  rowRef: RefObject<HTMLElement | null>,
  content: string,
  stepCount: number,
  floorFor: (width: number) => number = NO_FLOOR
): number {
  const [index, setIndex] = useState(0);
  // Bumped on each resize, so a shrink that keeps the step still re-checks the overflow.
  const [resizes, setResizes] = useState(0);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    let width = row.getBoundingClientRect().width;
    setIndex(floorFor(width));
    if (typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    // A frame later: changing the row inside the callback raises a ResizeObserver loop error.
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.borderBoxSize?.[0]?.inlineSize ?? row.getBoundingClientRect().width;
      if (next === width) return;
      const grew = next > width;
      width = next;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setIndex(current => (grew ? floorFor(next) : Math.max(current, floorFor(next))));
        setResizes(count => count + 1);
      });
    });
    observer.observe(row, { box: 'border-box' });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [rowRef, content, floorFor]);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (row && index < stepCount - 1 && row.scrollWidth > row.clientWidth) setIndex(index + 1);
  }, [rowRef, index, stepCount, content, resizes]);

  return index;
}
