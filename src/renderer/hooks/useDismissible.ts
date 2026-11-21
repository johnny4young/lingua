import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

/** Outside-click and Escape close for a popover anchored in `anchorRef`; Escape can hand focus back to its trigger. */
export function useDismissible(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  setOpen: Dispatch<SetStateAction<boolean>>,
  returnFocusRef?: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      returnFocusRef?.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchorRef, open, setOpen, returnFocusRef]);
}
