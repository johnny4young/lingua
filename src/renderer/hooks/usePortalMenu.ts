import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useFloatingPosition } from './useFloatingPosition';
import { useMenuKeyboard } from './useMenuKeyboard';

/**
 * A role=menu portaled under its trigger: placement, arrow keys, closing on a
 * click outside both, and Escape or Tab handing focus back to the trigger.
 */
export function usePortalMenu() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const position: CSSProperties = useFloatingPosition(triggerRef, open, 'below');
  // A hidden menu cannot take focus, so keyboard handling starts once it is placed.
  useMenuKeyboard(open && position.visibility !== 'hidden', menuRef);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' && event.key !== 'Tab') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
    }
    // Tab continues from the trigger; the portaled menu sits at the end of the page.
    triggerRef.current?.focus();
    setOpen(false);
  };

  /** Closes the menu and returns focus to the trigger, before a picked item runs. */
  const closeToTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return { open, setOpen, triggerRef, menuRef, position, onMenuKeyDown, closeToTrigger };
}
