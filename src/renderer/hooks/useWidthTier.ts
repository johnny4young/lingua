import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * How many of the ascending widths the element reaches; re-renders only when that count changes.
 * `unmeasured` is the tier for a zero width (not laid out yet, or jsdom).
 */
export function useWidthTier(ref: RefObject<HTMLElement | null>, widths: readonly number[], unmeasured = 0): number {
  const [tier, setTier] = useState(unmeasured);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || widths.length === 0) return;
    const measure = (width: number) => setTier(width === 0 ? unmeasured : widths.filter(min => width >= min).length);
    measure(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, widths, unmeasured]);
  return tier;
}
