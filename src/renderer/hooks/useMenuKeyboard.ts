import { useEffect, type RefObject } from 'react';

/** Arrow-key, Home and End movement through an open role=menu; focus starts on the checked or first enabled item. */
export function useMenuKeyboard(open: boolean, menuRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    const items = () => [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')];
    (menu.querySelector<HTMLElement>('[aria-checked="true"]:not(:disabled)') ?? items()[0])?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      const list = items();
      if (list.length === 0 || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = list.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? list.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      list[next]?.focus();
    };
    menu.addEventListener('keydown', onKeyDown);
    return () => menu.removeEventListener('keydown', onKeyDown);
  }, [open, menuRef]);
}
