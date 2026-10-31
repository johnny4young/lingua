import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface CapsuleMenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  testid: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/** A menu that opens above its trigger; Escape closes the menu, not the dialog. */
export function CapsuleActionMenu({
  label,
  trigger,
  triggerClassName,
  triggerTestId,
  items,
  align = 'left',
}: {
  label: string;
  trigger: ReactNode;
  triggerClassName: string;
  triggerTestId: string;
  items: readonly CapsuleMenuItem[];
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const menuItems = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const index = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
      return;
    }
    const next =
      event.key === 'ArrowDown' ? (index + 1) % menuItems.length
      : event.key === 'ArrowUp' ? (index - 1 + menuItems.length) % menuItems.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? menuItems.length - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    menuItems[next]?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={triggerTestId}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          onBlur={(event) => {
            if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
          }}
          className={cn('dropdown-rich absolute bottom-[calc(100%+0.4rem)] z-50 w-max min-w-[200px]', align === 'right' ? 'right-0' : 'left-0')}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              data-testid={item.testid}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                'dropdown-rich-row flex w-full items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-40',
                item.danger && 'text-error-fg'
              )}
            >
              <span className="flex shrink-0">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
