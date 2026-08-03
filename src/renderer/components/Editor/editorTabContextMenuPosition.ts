import type { EditorTabContextMenuProps } from './editorTabContextMenuLoader';

const MENU_WIDTH_PX = 224;
const MENU_HEIGHT_PX = 252;
const VIEWPORT_PADDING_PX = 12;

/**
 * Keep the complete menu footprint inside the viewport.
 *
 * The estimates match the fixed width and worst-case six-action height; CSS
 * still lets the surface shrink on narrower displays.
 */
export function resolveEditorTabContextMenuAnchor(
  anchor: EditorTabContextMenuProps['anchor'],
  viewport = typeof window === 'undefined'
    ? null
    : { width: window.innerWidth, height: window.innerHeight }
): EditorTabContextMenuProps['anchor'] {
  if (!viewport) return anchor;
  return {
    top: Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(anchor.top, viewport.height - MENU_HEIGHT_PX - VIEWPORT_PADDING_PX)
    ),
    left: Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(anchor.left, viewport.width - MENU_WIDTH_PX - VIEWPORT_PADDING_PX)
    ),
  };
}
