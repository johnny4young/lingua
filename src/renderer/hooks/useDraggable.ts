/**
 * RL-071 Signal-Slate v2 — `useDraggable`.
 *
 * Pointer-based drag hook that persists the resulting `{x,y}` to
 * `localStorage` under a caller-supplied key. The hook clamps to the
 * viewport on hydrate so a saved coordinate that ends up off-screen
 * (smaller window, monitor change) never gets stuck.
 *
 * Used by the floating action pill and the floating Variables card.
 * The companion `<FloatingShell />` wrapper lives in
 * `components/ui/floating.tsx`.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent,
} from 'react';

export interface DraggablePosition {
  x: number;
  y: number;
}

export interface UseDraggableOptions {
  /** localStorage key. `null` disables persistence. */
  storageKey: string | null;
  /** Default `{x,y}` when no persisted value exists. */
  defaultPosition: DraggablePosition;
  /** Minimum margin to keep inside the viewport. */
  viewportMargin?: number;
  /** Width/height hint used by the viewport clamp. Optional. */
  size?: { width: number; height: number };
  /**
   * When the drag region is a whole card/surface, keep interactive
   * children clickable. Leave false for explicit handles, even when
   * the handle itself is rendered as a button.
   */
  ignoreInteractiveChildren?: boolean;
  /**
   * Optional external reset token. When it changes after mount, the
   * hook moves the surface back to `defaultPosition` without writing
   * that default back into localStorage.
   */
  resetSignal?: unknown;
}

export interface UseDraggableResult {
  position: DraggablePosition;
  /** Spread on the drag handle. */
  handleProps: HTMLAttributes<HTMLElement>;
  /** Reset position to the default. */
  reset: () => void;
  /** Programmatic move (e.g. window resize handler). */
  setPosition: (p: DraggablePosition) => void;
  /** True while the user is actively dragging. */
  isDragging: boolean;
}

function readPersisted(key: string | null): DraggablePosition | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'x' in parsed &&
      'y' in parsed &&
      typeof (parsed as { x: unknown }).x === 'number' &&
      typeof (parsed as { y: unknown }).y === 'number'
    ) {
      return { x: (parsed as DraggablePosition).x, y: (parsed as DraggablePosition).y };
    }
  } catch {
    /* fall through */
  }
  return null;
}

function clampToViewport(
  pos: DraggablePosition,
  size: { width: number; height: number } | undefined,
  margin: number,
): DraggablePosition {
  if (typeof window === 'undefined') return pos;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const sw = size?.width ?? 0;
  const sh = size?.height ?? 0;
  return {
    x: Math.max(margin, Math.min(pos.x, Math.max(margin, w - sw - margin))),
    y: Math.max(margin, Math.min(pos.y, Math.max(margin, h - sh - margin))),
  };
}

export function useDraggable(opts: UseDraggableOptions): UseDraggableResult {
  const {
    storageKey,
    defaultPosition,
    viewportMargin = 8,
    size,
    ignoreInteractiveChildren = false,
    resetSignal,
  } = opts;
  // RL-093 review — `size` is typically a fresh object literal passed
  // by the caller every render (`{ width: 700, height: 42 }`). Pulling
  // its primitives into stable values lets the callbacks/effects below
  // depend on numbers instead of an unstable identity, so they don't
  // re-create every render.
  const sizeW = size?.width ?? 0;
  const sizeH = size?.height ?? 0;
  const defaultX = defaultPosition.x;
  const defaultY = defaultPosition.y;
  const [position, setPositionState] = useState<DraggablePosition>(() => {
    const persisted = readPersisted(storageKey);
    return clampToViewport(
      persisted ?? { x: defaultX, y: defaultY },
      { width: sizeW, height: sizeH },
      viewportMargin,
    );
  });
  const [isDragging, setIsDragging] = useState(false);

  const startRef = useRef<
    | { pointerX: number; pointerY: number; posX: number; posY: number }
    | null
  >(null);
  const resetSignalMountedRef = useRef(false);

  const persist = useCallback(
    (p: DraggablePosition) => {
      if (!storageKey || typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(p));
      } catch {
        /* ignore quota errors */
      }
    },
    [storageKey],
  );

  const setPosition = useCallback(
    (p: DraggablePosition) => {
      const clamped = clampToViewport(p, { width: sizeW, height: sizeH }, viewportMargin);
      setPositionState(clamped);
      persist(clamped);
    },
    [persist, sizeW, sizeH, viewportMargin],
  );

  const reset = useCallback(() => {
    setPosition({ x: defaultX, y: defaultY });
  }, [defaultX, defaultY, setPosition]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      setPositionState((p) => clampToViewport(p, { width: sizeW, height: sizeH }, viewportMargin));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [sizeW, sizeH, viewportMargin]);

  useEffect(() => {
    if (!resetSignalMountedRef.current) {
      resetSignalMountedRef.current = true;
      return;
    }
    startRef.current = null;
    setIsDragging(false);
    setPositionState(
      clampToViewport({ x: defaultX, y: defaultY }, { width: sizeW, height: sizeH }, viewportMargin),
    );
  }, [resetSignal, defaultX, defaultY, sizeW, sizeH, viewportMargin]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const target = event.target as Element | null;
      if (
        ignoreInteractiveChildren &&
        target?.closest('button,a,input,select,textarea,[role="button"]')
      ) {
        return;
      }
      event.preventDefault();
      startRef.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        posX: position.x,
        posY: position.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
    },
    [ignoreInteractiveChildren, position.x, position.y],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const start = startRef.current;
      if (!start) return;
      const next = clampToViewport(
        {
          x: start.posX + (event.clientX - start.pointerX),
          y: start.posY + (event.clientY - start.pointerY),
        },
        { width: sizeW, height: sizeH },
        viewportMargin,
      );
      setPositionState(next);
    },
    [sizeW, sizeH, viewportMargin],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const start = startRef.current;
      if (!start) return;
      startRef.current = null;
      setIsDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setPositionState((p) => {
        persist(p);
        return p;
      });
    },
    [persist],
  );

  // RL-093 review — don't spread `role` or `aria-label` here. Consumers
  // already wrap the handle in a `<button aria-label="…">` with their
  // own translated label; injecting hardcoded English would override
  // it. The hook only contributes pointer handlers + touch/cursor css.
  const handleProps = useMemo<HTMLAttributes<HTMLElement>>(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      style: { touchAction: 'none', cursor: isDragging ? 'grabbing' : 'grab' },
    }),
    [isDragging, onPointerDown, onPointerMove, onPointerUp],
  );

  return { position, handleProps, reset, setPosition, isDragging };
}
