import { forwardRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../../i18n/runMeterCatalog';
import { usePortalMenu } from '../../hooks/usePortalMenu';
import { Kbd } from '../ui/chrome';
import type { DockTabId } from './dockTabs';

interface DockTabsMoreRow {
  id: DockTabId;
  icon: ReactNode;
  label: string;
  hint: string;
  badges: ReactNode;
  shortcut: string | null;
}

interface DockTabsMoreProps {
  /** Tabs that left the row, most used first; none leaves the trigger measured but out of sight. */
  rows: readonly DockTabsMoreRow[];
  /** A tab in the menu has a failing test. */
  alert: boolean;
  onPick: (id: DockTabId) => void;
}

/** The dock tabs that do not fit the row; the picked one comes back to it. */
export const DockTabsMore = forwardRef<HTMLDivElement, DockTabsMoreProps>(function DockTabsMore(
  { rows, alert, onPick },
  ref
) {
  const { t } = useTranslation();
  const { open, setOpen, triggerRef, menuRef, position, onMenuKeyDown, closeToTrigger } = usePortalMenu();
  const idle = rows.length === 0;

  return (
    <div ref={ref} className="dock-tabs-more flex shrink-0 items-stretch" data-idle={idle || undefined}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-haspopup="menu"
        aria-expanded={open && !idle}
        aria-label={t('bottomPanel.tabs.moreLabel')}
        tabIndex={idle ? -1 : undefined}
        data-testid="dock-tabs-more"
        className="dock-tab relative inline-flex h-[34px] items-center gap-1 px-3 text-caption font-medium text-fg-muted hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-fg"
      >
        <span>{t('bottomPanel.tabs.more')}</span>
        <ChevronDown size={12} aria-hidden="true" />
        {alert ? (
          <span
            data-testid="dock-tabs-more-alert"
            aria-hidden="true"
            className="absolute right-1.5 top-2 h-1.5 w-1.5 rounded-full bg-error-fg"
          />
        ) : null}
      </button>
      {open && !idle
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={t('bottomPanel.tabs.moreLabel')}
              data-testid="dock-tabs-more-menu"
              onKeyDown={onMenuKeyDown}
              style={position}
              className="dropdown-rich z-[1000] w-max min-w-[200px] max-w-[calc(100vw-16px)]"
            >
              {rows.map(row => (
                <button
                  key={row.id}
                  type="button"
                  role="menuitem"
                  title={row.hint}
                  data-testid={`dock-tabs-more-${row.id}`}
                  onClick={() => {
                    closeToTrigger();
                    onPick(row.id);
                  }}
                  className="dropdown-rich-row flex w-full items-center gap-2.5 text-left"
                >
                  <span aria-hidden="true" className="flex shrink-0 text-fg-subtle">{row.icon}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-[7px]">
                    {row.label}
                    {row.badges}
                  </span>
                  {row.shortcut ? (
                    <Kbd className="shrink-0">{row.shortcut}</Kbd>
                  ) : null}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  );
});
