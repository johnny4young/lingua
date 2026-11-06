import type { CSSProperties } from 'react';
import type { GuidedTourPlacement } from './guidedTourSteps';

export interface GuidedTourTargetRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

const MARGIN = 16;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Position measured translated content without covering the Console target. */
export function calculatePanelStyle(
  target: GuidedTourTargetRect | null,
  placement: GuidedTourPlacement | null,
  panel: { width: number; height: number },
  viewport: { width: number; height: number }
): CSSProperties {
  const viewportHeight = Math.max(0, viewport.height - MARGIN * 2);
  const aboveHeight = target ? Math.max(0, target.top - MARGIN * 2) : 0;
  const maxHeight =
    placement === 'top' && aboveHeight >= 120
      ? Math.min(viewportHeight, aboveHeight)
      : viewportHeight;
  const height = Math.min(panel.height, maxHeight);
  if (!target || !placement) {
    return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', maxHeight };
  }
  const maxLeft = Math.max(MARGIN, viewport.width - panel.width - MARGIN);
  const maxTop = Math.max(MARGIN, viewport.height - height - MARGIN);
  let left = target.left;
  let top = target.bottom + MARGIN;
  if (placement === 'right' || placement === 'right-start') {
    left = target.right + MARGIN;
    top = placement === 'right-start' ? target.top : target.top + target.height / 2 - height / 2;
    if (left > maxLeft) left = target.left - panel.width - MARGIN;
  }
  if (placement === 'bottom' || placement === 'top') {
    left = target.left + target.width / 2 - panel.width / 2;
    top = placement === 'top' ? target.top - height - MARGIN : target.bottom + MARGIN;
  }
  if (placement === 'bottom-end') left = target.right - panel.width;
  if (placement === 'inside-end') {
    // The target fills the editor, so the card sits in its empty lower corner.
    left = target.right - panel.width - MARGIN;
    top = target.bottom - height - MARGIN;
  } else if (top > maxTop && target.top > height + MARGIN * 2) top = target.top - height - MARGIN;
  return { left: clamp(left, MARGIN, maxLeft), top: clamp(top, MARGIN, maxTop), maxHeight };
}

type GuidedTourArrowSide = 'top' | 'bottom' | 'left' | 'right';

export interface GuidedTourArrow {
  side: GuidedTourArrowSide;
  left: number;
  top: number;
}

const ARROW_SIZE = 12;
const ARROW_INSET = 18;

/** The arrow sits on the card edge facing the target, aimed at the target's centre. */
export function calculateArrow(
  target: GuidedTourTargetRect,
  card: { left: number; top: number; width: number; height: number }
): GuidedTourArrow | null {
  const half = ARROW_SIZE / 2;
  const x = clamp(target.left + target.width / 2, card.left + ARROW_INSET, card.left + card.width - ARROW_INSET) - half;
  const y = clamp(target.top + target.height / 2, card.top + ARROW_INSET, card.top + card.height - ARROW_INSET) - half;
  if (card.top >= target.bottom) return { side: 'top', left: x, top: card.top - half };
  if (card.top + card.height <= target.top) return { side: 'bottom', left: x, top: card.top + card.height - half };
  if (card.left >= target.right) return { side: 'left', left: card.left - half, top: y };
  if (card.left + card.width <= target.left) return { side: 'right', left: card.left + card.width - half, top: y };
  return null;
}
