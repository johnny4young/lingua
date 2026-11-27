import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { DockTabId } from './dockTabs';

/**
 * Row steps in order: tab glyphs give way first, then the controls' labels (RunMeter.css,
 * testsDock.css, debugger.css). A row that still does not fit moves tabs into More.
 */
const DOCK_ROW_FIT_STEPS = ['full', 'labels', 'tight'] as const;
const COMPACT_STEPS = ['tight'] as const;

type ElementRef = RefObject<HTMLElement | null>;

/**
 * Sets `data-fit` on the tab row to the first step at which every tab fits; past the last step,
 * the tabs that do not fit leave for More. Returns them, most used first. Tabs in More keep
 * their size (BottomPanel lays them out of flow), so each fit measures every tab.
 * `ranked` is every available tab, most used first; `pinned` tabs never leave the row.
 */
export function useDockRowFit(
  rowRef: ElementRef,
  listRef: ElementRef,
  controlsRef: ElementRef,
  moreRef: ElementRef,
  compact: boolean,
  ranked: readonly DockTabId[],
  pinned: readonly DockTabId[]
): readonly DockTabId[] {
  const [overflow, setOverflow] = useState<readonly DockTabId[]>([]);
  const input = useRef({ ranked, pinned });
  const fitRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const row = rowRef.current;
    const list = listRef.current;
    const controls = controlsRef.current;
    const more = moreRef.current;
    if (!row || !list || !controls || !more) return;
    const steps = compact ? COMPACT_STEPS : DOCK_ROW_FIT_STEPS;
    const fit = () => {
      const { ranked, pinned } = input.current;
      const style = getComputedStyle(list);
      const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      let next: DockTabId[] = [];
      for (const step of steps) {
        row.dataset.fit = step;
        const widths: Record<string, number> = {};
        for (const tab of list.querySelectorAll<HTMLElement>('[data-dock-tab]')) {
          widths[tab.dataset.dockTab ?? ''] = tab.getBoundingClientRect().width;
        }
        const width = (id: DockTabId) => widths[id] ?? 0;
        const space = row.clientWidth - controls.getBoundingClientRect().width - padding;
        if (ranked.reduce((sum, id) => sum + width(id), 0) <= space + 0.5) {
          next = [];
          break;
        }
        // Past the last step: More takes its own width, pinned tabs stay, then the most used that still fit.
        let room = space - more.getBoundingClientRect().width;
        for (const id of pinned) room -= width(id);
        let open = true;
        next = ranked.filter(id => {
          if (pinned.includes(id)) return false;
          if (open && width(id) <= room + 0.5) {
            room -= width(id);
            return false;
          }
          open = false;
          return true;
        });
      }
      setOverflow(previous => (previous.join() === next.join() ? previous : next));
    };
    fitRef.current = fit;
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    // Only size changes refit: the row's width, the controls and each tab (a label or badge that widens it).
    // The refit waits a frame: changing sizes inside the callback raises a ResizeObserver loop error.
    let frame = 0;
    const refit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const resize = new ResizeObserver(refit);
    const observe = () => {
      resize.disconnect();
      for (const node of [row, controls, ...list.querySelectorAll('[data-dock-tab]')]) resize.observe(node);
    };
    observe();
    // A tab that appears or goes away.
    const mutation = new MutationObserver(() => {
      observe();
      refit();
    });
    mutation.observe(list, { childList: true });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      fitRef.current = () => {};
    };
  }, [rowRef, listRef, controlsRef, moreRef, compact]);

  // A pick or a tab that starts or stops applying re-ranks the row without rebuilding the observers.
  const tabsKey = `${ranked.join()}|${pinned.join()}`;
  useLayoutEffect(() => {
    input.current = { ranked, pinned };
    fitRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tabsKey carries ranked and pinned by value
  }, [tabsKey]);

  return overflow;
}
