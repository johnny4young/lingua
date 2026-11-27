import { useLayoutEffect, useState, type RefObject } from 'react';

/** The meta goes first, then kernel actions fold into ⋯, then the run range, and last the notice takes its own row. */
const STEPS = ['full', 'nometa', 'menu', 'runmenu', 'stacked'] as const;

export interface NotebookToolbarFit {
  readonly step: (typeof STEPS)[number];
  readonly showsMeta: boolean;
  readonly kernelInMenu: boolean;
  readonly runRangeInMenu: boolean;
}

/** Below this toolbar width the kernel actions always sit in ⋯. */
const MENU_BELOW_PX = 900;
const MENU = STEPS.indexOf('menu');
const RUN_MENU = STEPS.indexOf('runmenu');

const floorFor = (width: number) => (width > 0 && width < MENU_BELOW_PX ? MENU : 0);

/** The first step at which the row fits; `content` is whatever changes its natural width. */
export function useNotebookToolbarFit(rowRef: RefObject<HTMLElement | null>, content: string): NotebookToolbarFit {
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
  }, [rowRef, content]);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (row && index < STEPS.length - 1 && row.scrollWidth > row.clientWidth) setIndex(index + 1);
  }, [rowRef, index, content, resizes]);

  return {
    step: STEPS[index] ?? 'full',
    showsMeta: index === 0,
    kernelInMenu: index >= MENU,
    runRangeInMenu: index >= RUN_MENU,
  };
}
