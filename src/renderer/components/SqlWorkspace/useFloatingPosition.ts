import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

const GAP = 4;
const MARGIN = 8;
const MIN_BELOW = 160;

/**
 * Fixed coordinates for a popup rendered in a portal, so a short pane cannot
 * clip it. `below` hangs it under the anchor (flipping above when there is no
 * room); `inside` pins it to the anchor's top-right corner. Either way it
 * scrolls instead of leaving the viewport.
 */
export function useFloatingPosition(
  anchor: RefObject<HTMLElement | null>,
  open: boolean,
  placement: 'below' | 'inside'
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const right = Math.max(MARGIN, window.innerWidth - rect.right + (placement === 'inside' ? 12 : 0));
      if (placement === 'inside') {
        const top = Math.max(MARGIN, rect.top + MARGIN);
        setStyle({ position: 'fixed', top, right, maxHeight: window.innerHeight - top - MARGIN, overflowY: 'auto' });
        return;
      }
      const below = window.innerHeight - rect.bottom - GAP - MARGIN;
      const above = rect.top - GAP - MARGIN;
      setStyle(
        below < MIN_BELOW && above > below
          ? { position: 'fixed', right, bottom: window.innerHeight - rect.top + GAP, maxHeight: above, overflowY: 'auto' }
          : { position: 'fixed', right, top: rect.bottom + GAP, maxHeight: below, overflowY: 'auto' }
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, open, placement]);

  return style;
}
