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
    // Border box, as the first measure: a padding that follows the tier must not flip it back.
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.borderBoxSize?.[0]?.inlineSize ?? node.getBoundingClientRect().width);
    });
    observer.observe(node, { box: 'border-box' });
    return () => observer.disconnect();
  }, [ref, widths, unmeasured]);
  return tier;
}
