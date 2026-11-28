import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { usePortalMenu } from '../../hooks/usePortalMenu';
import { cn } from '../../utils/cn';
import { IconButton } from './chrome';
import { ICON_GLYPH } from './iconScale';

const MIN_WIDTH = 220;

export interface OverflowMenuItem {
  id: string;
  icon: ReactNode;
  label: string;
  title?: string;
  tone?: 'warning';
  /** A state the row reports as on; it cannot be toggled from here. */
  checked?: boolean;
  /** Omitted for a row that only reports state. */
  run?: () => void;
}

export interface OverflowMenuProps {
  label: string;
  items: readonly OverflowMenuItem[];
  /** Trigger test id; the menu is `<testId>-menu` and each row `<testId>-<id>`. */
  testId: string;
  /** Rows keep this test id prefix instead of the trigger's. */
  itemTestIdPrefix?: string;
  /** Marks the trigger with a warning dot. */
  attention?: boolean;
  tooltipSide?: 'top' | 'bottom';
}

/** A ⋯ trigger with a role=menu portaled under it, so clipped panes (dock, sidebar) never cut it. */
export function OverflowMenu({ label, items, testId, itemTestIdPrefix = testId, attention = false, tooltipSide }: OverflowMenuProps) {
  const { open, setOpen, triggerRef, menuRef, position, onMenuKeyDown, closeToTrigger } = usePortalMenu();

  return (
    <>
      <IconButton
        ref={triggerRef}
        onClick={() => setOpen(value => !value)}
        tooltip={label}
        tooltipSide={tooltipSide}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        className="relative"
      >
        <MoreHorizontal size={ICON_GLYPH.md} />
        {attention ? <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warning" /> : null}
      </IconButton>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={label}
              data-testid={`${testId}-menu`}
              onKeyDown={onMenuKeyDown}
              style={{ ...position, minWidth: Math.min(MIN_WIDTH, Number(position.maxWidth ?? MIN_WIDTH)) }}
              className="dropdown-rich z-[1000] w-max"
            >
              {items.map(item => (
                <button
                  key={item.id}
                  type="button"
                  role={item.checked ? 'menuitemcheckbox' : 'menuitem'}
                  aria-checked={item.checked}
                  aria-disabled={item.run ? undefined : true}
                  data-testid={`${itemTestIdPrefix}-${item.id}`}
                  title={item.title}
                  onClick={() => {
                    if (!item.run) return;
                    closeToTrigger();
                    item.run();
                  }}
                  className={cn('dropdown-rich-row flex w-full items-center gap-3 text-left', item.tone === 'warning' && 'text-warning')}
                >
                  <span aria-hidden="true" className="flex shrink-0">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
