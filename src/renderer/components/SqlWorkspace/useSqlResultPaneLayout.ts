import { useLayoutEffect, useRef, useState } from 'react';

// The grid header and a row or two. With less room than this the grid takes the pane.
const MIN_GRID_PX = 72;

/** Sizes of the grid-first layout, or `null` when the bands and the grid fit together. */
export interface SqlGridFirstLayout {
  gridHeight: number;
  headerHeight: number;
  /** The pane below its pinned header. */
  viewHeight: number;
}

function measure(
  pane: HTMLElement | null,
  header: HTMLElement | null,
  body: HTMLElement | null,
  pin: HTMLElement | null
): SqlGridFirstLayout | null {
  if (!pane || !header || !body || pane.clientHeight === 0) return null;
  // Layout offsets ignore scroll and the body's own height, so the answer never depends on the mode it picks.
  const bodyTop = body.offsetTop;
  const below = pane.scrollHeight - bodyTop - body.offsetHeight;
  if (pane.clientHeight - bodyTop - below >= MIN_GRID_PX) return null;
  const viewHeight = pane.clientHeight - header.offsetHeight;
  return {
    gridHeight: Math.max(MIN_GRID_PX, viewHeight - (pin?.offsetHeight ?? 0)),
    headerHeight: header.offsetHeight,
    viewHeight,
  };
}

const sameLayout = (a: SqlGridFirstLayout | null, b: SqlGridFirstLayout | null) =>
  a === b ||
  (a !== null && b !== null && a.gridHeight === b.gridHeight && a.headerHeight === b.headerHeight && a.viewHeight === b.viewHeight);

/**
 * On a pane too short for its bands and the grid, the grid fills the pane under
 * the pinned header, the bands sit one scroll above it and the footer one below.
 * `showGridKey` scrolls back to the grid when it changes: a new response, not a filter.
 */
export function useSqlResultPaneLayout(hasRows: boolean, hasPin: boolean, showGridKey: string | null) {
  const paneRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<SqlGridFirstLayout | null>(null);

  // Every commit: a band can mount, unmount or wrap, and each one moves the grid.
  useLayoutEffect(() => {
    const update = () => {
      const next = hasRows ? measure(paneRef.current, headerRef.current, bodyRef.current, hasPin ? pinRef.current : null) : null;
      setLayout((current) => (sameLayout(current, next) ? current : next));
    };
    update();
    const pane = paneRef.current;
    if (!pane || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(pane);
    for (const band of pane.children) observer.observe(band);
    return () => observer.disconnect();
  });

  const gridFirst = layout !== null;
  const pinned = gridFirst && hasPin;
  useLayoutEffect(() => {
    const pane = paneRef.current;
    const body = bodyRef.current;
    if (!gridFirst || !pane || !body) return;
    const covered = (headerRef.current?.offsetHeight ?? 0) + (pinned ? (pinRef.current?.offsetHeight ?? 0) : 0);
    pane.scrollTop = body.offsetTop - covered;
  }, [gridFirst, pinned, showGridKey]);

  return { paneRef, headerRef, bodyRef, pinRef, layout, pinned };
}
