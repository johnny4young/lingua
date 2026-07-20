import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/**
 * implementation note — right-click context menu for the file
 * tree. Mirrors the `EditorTabContextMenu` portal pattern so the
 * menu is never clipped by the sidebar's `overflow-y-auto`.
 *
 * implementation ships a single action — "Reveal in Finder" — that is only
 * surfaced on the desktop build (the web FSA wrapper has no native
 * absolute path). Future implementation note extend the `items` prop as new
 * actions land (Copy path, Reveal in Tab, Open with…).
 */
export interface FileTreeContextMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

export interface FileTreeContextMenuProps {
  anchor: { top: number; left: number };
  /** Display name for the aria-label fallback. */
  nodeName: string;
  items: ReadonlyArray<FileTreeContextMenuItem>;
  onClose: () => void;
}

export function FileTreeContextMenu({
  anchor,
  nodeName,
  items,
  onClose,
}: FileTreeContextMenuProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  // Focus the first available item so the user can keyboard-arrow
  // immediately after Shift+F10 / ContextMenu key.
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')
      ?.focus();
  }, []);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)'
      )
    );
    if (buttons.length === 0) return;

    event.preventDefault();
    const currentIndex = buttons.findIndex(
      (button) => button === document.activeElement
    );
    const lastIndex = buttons.length - 1;
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? lastIndex
          : event.key === 'ArrowDown'
            ? (currentIndex + 1 + buttons.length) % buttons.length
            : (currentIndex - 1 + buttons.length) % buttons.length;

    buttons[nextIndex]?.focus();
  };

  if (typeof document === 'undefined') return null;

  const wrap = (action: () => void) => () => {
    action();
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={t('fileTree.menu.ariaLabel', { name: nodeName })}
      tabIndex={-1}
      data-testid="file-tree-context-menu"
      onKeyDown={handleMenuKeyDown}
      className="surface-panel-strong fixed z-[12000] min-w-[12rem] p-1 outline-none"
      style={{ top: anchor.top, left: anchor.left }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={wrap(item.onSelect)}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-body-sm text-foreground transition-colors hover:bg-surface-strong/82 focus:bg-surface-strong/88 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <span className="flex-1">{item.label}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}
