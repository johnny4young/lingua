import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
 * RL-123 / AUDIT-03 Slice 2 — hand-rolled variable-height list windower.
 *
 * The list renders only the rows whose vertical band intersects the
 * viewport (plus an overscan margin), padding the rest with two spacer
 * divs so the scrollbar geometry matches the full list. Rows that scroll
 * out of the window unmount, which releases their per-row resources for
 * free (the console's `<RichValueChart>` finalize()s its Vega view on
 * unmount; a notebook code cell drops its Monaco editor — RL-043 Slice H).
 *
 * We hand-roll instead of pulling `react-window` because rows are variable
 * height (one ANSI line vs. a rich table vs. a chart; a one-line markdown
 * cell vs. a tall editor), the dep delta is avoidable, and the only hard
 * parts — the offset math — are the pure {@link computeWindow} and
 * {@link offsetForIndex} functions, both fully unit-tested without a DOM.
 *
 * RL-043 Slice H promoted this hook out of `components/Console/` into the
 * shared `hooks/` folder so the notebook can window its cell rows too, and
 * added {@link UseListWindowResult.scrollToIndex} for programmatic
 * row-into-view scrolls (Jupyter command-mode navigation).
 */

/**
 * The slice of a list to mount plus the spacer heights that preserve scroll
 * geometry. `endIndex` is inclusive; an empty list yields
 * `{ startIndex: 0, endIndex: -1 }` so `slice(startIndex, endIndex + 1)`
 * renders nothing.
 */
export interface ListWindow {
  /** First row index to mount (inclusive). 0 when the list is empty. */
  startIndex: number;
  /** Last row index to mount (inclusive). -1 when the list is empty. */
  endIndex: number;
  /** Pixel height of the spacer rendered above the first mounted row. */
  topSpacer: number;
  /** Pixel height of the spacer rendered below the last mounted row. */
  bottomSpacer: number;
}

/** Pure inputs to {@link computeWindow}; all heights are in CSS pixels. */
export interface ComputeWindowParams {
  /** Number of rows in the (already filtered) list. */
  count: number;
  /**
   * Measured row heights indexed by position. A missing/`undefined`/`<= 0`
   * entry falls back to `estimate`, so an as-yet-unmeasured row still gets a
   * plausible offset.
   */
  heights: ReadonlyArray<number | undefined>;
  /** Current `scrollTop` of the scroll container. */
  scrollTop: number;
  /** Visible height of the scroll container (`clientHeight`). */
  viewportHeight: number;
  /** Extra pixels mounted above and below the viewport to avoid blank flashes. */
  overscanPx: number;
  /** Fallback height for unmeasured rows. */
  estimate: number;
}

/**
 * Compute the row window for the current scroll position. Pure: no DOM, no
 * React — so it is exhaustively unit-testable even though jsdom cannot
 * measure layout.
 *
 * Degrade-to-full: when `viewportHeight <= 0` (jsdom, or a container that
 * has not been laid out yet) the whole list is returned with zero spacers,
 * so unit tests and the first pre-layout paint render every row exactly as
 * they did before virtualization.
 */
export function computeWindow({
  count,
  heights,
  scrollTop,
  viewportHeight,
  overscanPx,
  estimate,
}: ComputeWindowParams): ListWindow {
  if (count <= 0) {
    return { startIndex: 0, endIndex: -1, topSpacer: 0, bottomSpacer: 0 };
  }
  if (viewportHeight <= 0) {
    return { startIndex: 0, endIndex: count - 1, topSpacer: 0, bottomSpacer: 0 };
  }

  const heightAt = (index: number): number => {
    const value = heights[index];
    return typeof value === 'number' && value > 0 ? value : estimate;
  };

  // Prefix sums: offsets[i] is the top edge of row i; offsets[count] is the
  // total content height. O(n) per recompute, fine for the few-hundred rows
  // a flooded console holds and gated behind a rAF-throttled scroll handler.
  const offsets = new Array<number>(count + 1);
  offsets[0] = 0;
  for (let i = 0; i < count; i += 1) {
    offsets[i + 1] = (offsets[i] ?? 0) + heightAt(i);
  }
  const offsetAt = (index: number): number => offsets[index] ?? 0;
  const total = offsetAt(count);

  const top = Math.max(0, scrollTop - overscanPx);
  const bottom = scrollTop + viewportHeight + overscanPx;

  // First row whose bottom edge is past the top of the overscan band.
  let startIndex = 0;
  while (startIndex < count - 1 && offsetAt(startIndex + 1) <= top) {
    startIndex += 1;
  }
  // Last row whose top edge is before the bottom of the overscan band.
  let endIndex = startIndex;
  while (endIndex < count - 1 && offsetAt(endIndex + 1) < bottom) {
    endIndex += 1;
  }

  return {
    startIndex,
    endIndex,
    topSpacer: offsetAt(startIndex),
    bottomSpacer: total - offsetAt(endIndex + 1),
  };
}

/**
 * Pixel top-offset of row `index` — the sum of measured heights for rows
 * `[0, index)`, falling back to `estimate` for any unmeasured (`undefined`
 * / `<= 0`) entry. Pure, so it is unit-testable without a DOM and shares
 * the exact height model {@link computeWindow} uses, keeping
 * {@link UseListWindowResult.scrollToIndex} consistent with the window
 * math.
 *
 * Clamps `index` into `[0, heights.length]`: a negative index yields 0, an
 * index past the end yields the total content height (the bottom edge of
 * the last row). RL-043 Slice H.
 */
export function offsetForIndex(
  heights: ReadonlyArray<number | undefined>,
  index: number,
  estimate: number
): number {
  const clamped = Math.max(0, Math.min(index, heights.length));
  let offset = 0;
  for (let i = 0; i < clamped; i += 1) {
    const value = heights[i];
    offset += typeof value === 'number' && value > 0 ? value : estimate;
  }
  return offset;
}

/** Options for {@link useListWindow}. */
export interface UseListWindowOptions {
  /** Ref to the scrolling container element. */
  scrollRef: RefObject<HTMLElement | null>;
  /**
   * Stable key per row, in render order. Length defines the row count, and
   * measured heights are cached by key so they survive filter-driven
   * reorders (and are pruned when a key leaves the list).
   */
  keys: readonly string[];
  /** Fallback height for unmeasured rows (CSS px). Default 28. */
  estimate?: number;
  /** Overscan margin above/below the viewport (CSS px). Default 600. */
  overscanPx?: number;
}

/** Return value of {@link useListWindow}. */
export interface UseListWindowResult {
  /** The row slice + spacer heights to render this frame. */
  listWindow: ListWindow;
  /**
   * Callback-ref factory: `ref={measureRef(key)}` on each mounted row wires
   * its height into the cache via `ResizeObserver`. The returned callback is
   * stable per key so React does not detach/reattach it every render.
   */
  measureRef: (key: string) => (element: HTMLElement | null) => void;
  /** Imperatively pin the container to the bottom (sticky auto-scroll). */
  scrollToBottom: () => void;
  /**
   * RL-043 Slice H — imperatively scroll row `index` into view. Computes
   * the row's top offset from the same measured-height cache the window
   * math uses (see {@link offsetForIndex}), scrolls the container there
   * instantly, and immediately seeds the internal `scrollTop` so the window
   * recomputes on the next render without waiting for the throttled scroll
   * listener — critical so a just-activated off-screen row mounts promptly.
   */
  scrollToIndex: (index: number) => void;
}

const DEFAULT_ESTIMATE = 28;
const DEFAULT_OVERSCAN_PX = 600;

/**
 * React binding around {@link computeWindow}. Tracks the container's
 * `scrollTop`/`clientHeight`, measures mounted rows with a shared
 * `ResizeObserver`, and recomputes the window when any of those change.
 *
 * In environments without `ResizeObserver` or layout (jsdom), the container
 * reports `clientHeight === 0`, so {@link computeWindow} degrades to the
 * full list and component tests keep rendering every row.
 */
export function useListWindow({
  scrollRef,
  keys,
  estimate = DEFAULT_ESTIMATE,
  overscanPx = DEFAULT_OVERSCAN_PX,
}: UseListWindowOptions): UseListWindowResult {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  // Bumped whenever a measurement actually changes, to force a recompute.
  const [measureVersion, setMeasureVersion] = useState(0);

  const heightsRef = useRef<Map<string, number>>(new Map());
  const refCacheRef = useRef<Map<string, (element: HTMLElement | null) => void>>(
    new Map()
  );
  const elementKeyRef = useRef<WeakMap<HTMLElement, string>>(new WeakMap());
  // The element currently observed for each key, so we can unobserve it when
  // the row unmounts or its element is replaced (preventing a ResizeObserver
  // leak of detached nodes as rows scroll out of the window).
  const observedRef = useRef<Map<string, HTMLElement>>(new Map());
  const rowObserverRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef<number | null>(null);

  const count = keys.length;

  // Fold F — prune cached heights and ref callbacks for keys that have left
  // the list (clear, filter toggle), so the caches cannot grow unbounded
  // across a long session.
  const keySignature = keys.join(',');
  useLayoutEffect(() => {
    const live = new Set(keys);
    for (const key of heightsRef.current.keys()) {
      if (!live.has(key)) heightsRef.current.delete(key);
    }
    for (const key of refCacheRef.current.keys()) {
      if (!live.has(key)) refCacheRef.current.delete(key);
    }
    for (const [key, element] of observedRef.current) {
      if (!live.has(key)) {
        rowObserverRef.current?.unobserve(element);
        observedRef.current.delete(key);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keySignature is the stable digest of `keys`.
  }, [keySignature]);

  // Track container size + scroll position. useLayoutEffect so the viewport
  // height is known before the first paint and windowing engages immediately.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const syncScroll = () => {
      if (rafRef.current !== null) return;
      const schedule =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16);
      rafRef.current = schedule(() => {
        rafRef.current = null;
        const node = scrollRef.current;
        if (node) setScrollTop(node.scrollTop);
      }) as unknown as number;
    };

    setScrollTop(element.scrollTop);
    setViewportHeight(element.clientHeight);
    element.addEventListener('scroll', syncScroll, { passive: true });

    let containerObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      containerObserver = new ResizeObserver(() => {
        const node = scrollRef.current;
        if (node) setViewportHeight(node.clientHeight);
      });
      containerObserver.observe(element);
    }

    return () => {
      element.removeEventListener('scroll', syncScroll);
      containerObserver?.disconnect();
      if (rafRef.current !== null) {
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafRef.current);
        }
        rafRef.current = null;
      }
    };
  }, [scrollRef]);

  // Shared per-row observer, created lazily on first use. It must NOT live in a
  // layout effect: callback refs (measureRef below) fire during commit, BEFORE
  // layout effects run, so on first mount the observer would not exist yet and
  // the initial window's rows would never be observed (an async-resizing chart
  // in the first viewport would keep a stale height). Lazy creation guarantees
  // the observer exists whenever a measure callback needs it. It ignores zero
  // readings — a content-visibility-skipped row reports 0, and we keep its last
  // known height instead of corrupting the offsets.
  const getRowObserver = useCallback((): ResizeObserver | null => {
    if (rowObserverRef.current) return rowObserverRef.current;
    if (typeof ResizeObserver === 'undefined') return null;
    const observer = new ResizeObserver((batch) => {
      let changed = false;
      for (const entry of batch) {
        const element = entry.target as HTMLElement;
        const key = elementKeyRef.current.get(element);
        if (key === undefined) continue;
        // RL-043 Slice H — measure the BORDER box, not the content box, so
        // per-row padding/border (notebook rows carry a `pb-3` gap) is
        // counted exactly and the offset math matches the initial
        // `getBoundingClientRect().height` (also a border box) read below.
        // Falls back to `contentRect.height` where `borderBoxSize` is
        // unavailable. (Console rows have no padding/border, so this is a
        // no-op for them.)
        const height =
          entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (height > 0 && heightsRef.current.get(key) !== height) {
          heightsRef.current.set(key, height);
          changed = true;
        }
      }
      if (changed) setMeasureVersion((version) => version + 1);
    });
    rowObserverRef.current = observer;
    return observer;
  }, []);

  // Disconnect the shared observer (and drop element references) on unmount.
  useEffect(
    () => () => {
      rowObserverRef.current?.disconnect();
      rowObserverRef.current = null;
      observedRef.current.clear();
    },
    []
  );

  const measureRef = useCallback(
    (key: string) => {
      const cached = refCacheRef.current.get(key);
      if (cached) return cached;
      const callback = (element: HTMLElement | null) => {
        // React calls the ref with null on unmount and with a new element on
        // replace. Unobserve the element we were tracking for this key first,
        // so scrolled-out rows don't leak as detached-but-observed nodes —
        // which would defeat the windower's whole memory goal.
        const previous = observedRef.current.get(key);
        if (previous && previous !== element) {
          getRowObserver()?.unobserve(previous);
          observedRef.current.delete(key);
        }
        if (element) {
          observedRef.current.set(key, element);
          elementKeyRef.current.set(element, key);
          const height = element.getBoundingClientRect().height;
          if (height > 0 && heightsRef.current.get(key) !== height) {
            heightsRef.current.set(key, height);
            setMeasureVersion((version) => version + 1);
          }
          getRowObserver()?.observe(element);
        }
      };
      refCacheRef.current.set(key, callback);
      return callback;
    },
    [getRowObserver]
  );

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [scrollRef]);

  // RL-043 Slice H — imperatively scroll a row into view. Uses the same
  // measured-height cache + `estimate` the window math reads, so the target
  // offset is consistent with the rendered geometry.
  const scrollToIndex = useCallback(
    (index: number) => {
      const element = scrollRef.current;
      if (!element) return;
      // Imperative scroll handler reads the live height cache on demand; it
      // runs in an event/effect path, not during render.
      const heights = keys.map((key) => heightsRef.current.get(key));
      const offset = offsetForIndex(heights, index, estimate);
      if (typeof element.scrollTo === 'function') {
        element.scrollTo({ top: offset, behavior: 'auto' });
      } else {
        // jsdom / older runtimes lack `scrollTo`; set the position directly.
        element.scrollTop = offset;
      }
      // Seed the internal scroll position immediately so the window
      // recomputes on the next render rather than waiting for the
      // rAF-throttled scroll listener — a just-activated off-screen row must
      // mount before focus is attempted.
      setScrollTop(offset);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keySignature is the stable digest of `keys`.
    [scrollRef, keySignature, estimate]
  );

  const listWindow = useMemo(() => {
    // eslint-disable-next-line react-hooks/refs -- intentional read of the measurement cache during render; `measureVersion` invalidates this memo whenever a cached height changes, so the derived window stays correct.
    const heights = keys.map((key) => heightsRef.current.get(key));
    return computeWindow({
      count,
      heights,
      scrollTop,
      viewportHeight,
      overscanPx,
      estimate,
    });
    // measureVersion forces a recompute when a cached height changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySignature, count, scrollTop, viewportHeight, overscanPx, estimate, measureVersion]);

  return { listWindow, measureRef, scrollToBottom, scrollToIndex };
}
