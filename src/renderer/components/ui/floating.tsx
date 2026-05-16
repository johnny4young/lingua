/**
 * RL-071 Signal-Slate v2 — floating shell.
 *
 * `<FloatingShell />` is an `absolute`-positioned wrapper used by the
 * v2 action pill and the v2 Variables card. The drag hook lives in
 * `hooks/useDraggable.ts`; consumers pass `position` and (optionally)
 * a `fullSurfaceHandle` whose pointer handlers come from
 * `useDraggable().handleProps`.
 */

import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react';
import { cn } from '../../utils/cn';
import type { DraggablePosition } from '../../hooks/useDraggable';

export type FloatingVariant = 'pill' | 'card';

export interface FloatingShellProps extends HTMLAttributes<HTMLDivElement> {
  position: DraggablePosition;
  /** Pointer handlers from `useDraggable().handleProps` when the whole surface is the drag region. */
  fullSurfaceHandle?: HTMLAttributes<HTMLElement>;
  /** `pill` = full radius; `card` = rounded-xl. */
  variant?: FloatingVariant;
  /** z-index override. Defaults to 30 (above tabs, under modals). */
  zIndex?: number;
}

export const FloatingShell = forwardRef<HTMLDivElement, FloatingShellProps>(function FloatingShell(
  { position, fullSurfaceHandle, variant = 'pill', zIndex = 30, className, style, children, ...rest },
  ref,
) {
  const computedStyle: CSSProperties = {
    position: 'absolute',
    left: position.x,
    top: position.y,
    zIndex,
    ...style,
  };
  return (
    <div
      ref={ref}
      className={cn(
        variant === 'pill'
          ? 'rounded-full border border-border/80 bg-bg-panel/95 shadow-[0_18px_40px_-20px_rgba(15,15,40,0.18)] backdrop-blur-xl'
          : 'rounded-xl border border-border/80 bg-bg-panel/95 shadow-[0_18px_36px_-12px_rgba(15,15,40,0.22)] backdrop-blur-xl',
        className,
      )}
      style={computedStyle}
      {...rest}
      {...fullSurfaceHandle}
    >
      {children}
    </div>
  );
});
