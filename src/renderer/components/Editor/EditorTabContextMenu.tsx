import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Kbd } from '../ui/chrome';

/**
 * Anchored context menu for editor tabs. Renders through a portal so
 * the menu is never clipped by the surface-header overflow rules of
 * the tab strip. Closes on outside click, on Escape, and after any
 * action runs.
 *
 * Menu items follow the DS spec from
 * lingua/project/components/signal-tabs-editor.jsx — the close
 * cluster first (with their global shortcuts inline as Kbd hints),
 * then rename + duplicate. Items that need a feature not yet wired
 * (pin, reveal in Finder, copy path) are tracked in BACKLOG and
 * intentionally absent here.
 */
export interface EditorTabContextMenuProps {
  anchor: { top: number; left: number };
  tabName: string;
  isLastTab: boolean;
  isRightmost: boolean;
  onClose: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onCloseAll: () => void;
  onRename: () => void;
  onDuplicate: () => void;
}

export function EditorTabContextMenu({
  anchor,
  tabName,
  isLastTab,
  isRightmost,
  onClose,
  onCloseTab,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onRename,
  onDuplicate,
}: EditorTabContextMenuProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  // UX Sweep T3 — remember what was focused before the menu opened
  // (the triggering tab, for Shift+F10 / ContextMenu key) so focus can
  // return there on close instead of falling to the document body.
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );

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

  // Focus the first available action on open so keyboard users can
  // continue with arrows/Enter after Shift+F10 or the ContextMenu key.
  // On close, return focus to the triggering tab — but only if focus was
  // simply lost (Escape / outside-click). An action that moves focus
  // itself (Rename opens an input) must keep it, so the restore no-ops
  // when something already grabbed focus.
  useEffect(() => {
    const previouslyFocused = previouslyFocusedRef.current;
    ref.current
      ?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')
      ?.focus();
    return () => {
      if (!previouslyFocused || !document.contains(previouslyFocused)) return;
      requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        try {
          previouslyFocused.focus({ preventScroll: true });
        } catch {
          // Detached node during strict-mode double-mount — ignore.
        }
      });
    };
  }, []);

  const wrap = (action: () => void) => () => {
    action();
    onClose();
  };

  // Disable Close-others when there is only one tab open (running it
  // would no-op silently); disable Close-to-the-right when the
  // anchored tab is already the last one.
  const closeOthersDisabled = isLastTab;
  const closeRightDisabled = isLastTab || isRightmost;

  const items: ReadonlyArray<MenuItem | 'divider'> = [
    {
      key: 'close',
      label: t('editorTabs.menu.close'),
      kbd: '⌘W',
      onSelect: onCloseTab,
    },
    {
      key: 'closeOthers',
      label: t('editorTabs.menu.closeOthers'),
      onSelect: onCloseOthers,
      disabled: closeOthersDisabled,
    },
    {
      key: 'closeRight',
      label: t('editorTabs.menu.closeRight'),
      onSelect: onCloseToRight,
      disabled: closeRightDisabled,
    },
    {
      key: 'closeAll',
      label: t('editorTabs.menu.closeAll'),
      kbd: '⌘⇧W',
      onSelect: onCloseAll,
    },
    'divider',
    {
      key: 'rename',
      label: t('editorTabs.menu.rename'),
      kbd: 'F2',
      onSelect: onRename,
    },
    {
      key: 'duplicate',
      label: t('editorTabs.menu.duplicate'),
      onSelect: onDuplicate,
    },
  ];

  if (typeof document === 'undefined') return null;

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)'
      )
    );
    if (buttons.length === 0) return;

    event.preventDefault();
    const currentIndex = buttons.findIndex((button) => button === document.activeElement);
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

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={t('editorTabs.menu.ariaLabel', { name: tabName })}
      tabIndex={-1}
      data-testid="editor-tab-context-menu"
      onKeyDown={handleMenuKeyDown}
      className="surface-panel-strong fixed z-[12000] min-w-[14rem] p-1 outline-none"
      style={{ top: anchor.top, left: anchor.left }}
    >
      {items.map((item, index) => {
        if (item === 'divider') {
          return (
            <div
              key={`divider-${index}`}
              role="separator"
              className="my-1 h-px bg-border/80"
            />
          );
        }
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={wrap(item.onSelect)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-body-sm text-foreground transition-colors hover:bg-surface-strong/82 focus:bg-surface-strong/88 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="flex-1">{item.label}</span>
            {item.kbd && <Kbd>{item.kbd}</Kbd>}
          </button>
        );
      })}
    </div>,
    document.body
  );
}

interface MenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  kbd?: string;
  disabled?: boolean;
}
