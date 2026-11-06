import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../ui/chrome';
import { ICON_GLYPH } from '../ui/iconScale';

const MIN_WIDTH = 220;

export interface FileTreeHeaderAction {
  id: string;
  label: string;
  icon: ReactNode;
  run: () => void;
}

/** The Explorer's less frequent actions, so the project name keeps the header's width. */
export function FileTreeHeaderMenu({ actions }: { actions: FileTreeHeaderAction[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // The sidebar clips anything past its edges, so the menu grows left from the trigger and wraps if it must.
  const [maxWidth, setMaxWidth] = useState<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
      return;
    }
    const next =
      event.key === 'ArrowDown' ? (index + 1) % items.length
      : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <IconButton
        onClick={() => {
          setMaxWidth((rootRef.current?.getBoundingClientRect().right ?? 0) - 8 || undefined);
          setOpen(value => !value);
        }}
        tooltip={t('fileTree.actions.more')}
        aria-label={t('fileTree.actions.more')}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="file-tree-more"
      >
        <MoreHorizontal size={ICON_GLYPH.md} />
      </IconButton>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('fileTree.actions.more')}
          onKeyDown={onKeyDown}
          style={{ maxWidth, minWidth: Math.min(MIN_WIDTH, maxWidth ?? MIN_WIDTH) }}
          onBlur={event => {
            if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
          }}
          className="dropdown-rich absolute right-0 top-[calc(100%+0.4rem)] z-50 w-max"
        >
          {actions.map(action => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              data-testid={`file-tree-${action.id}`}
              onClick={() => {
                setOpen(false);
                action.run();
              }}
              className="dropdown-rich-row flex w-full items-center gap-3 text-left"
            >
              <span className="flex shrink-0">{action.icon}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
