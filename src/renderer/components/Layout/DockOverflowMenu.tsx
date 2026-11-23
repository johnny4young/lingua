import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, MoreHorizontal, Package, PauseCircle, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../../i18n/runMeterCatalog';
import { useFloatingPosition } from '../../hooks/useFloatingPosition';
import { useMenuKeyboard } from '../../hooks/useMenuKeyboard';
import { emitCommand } from '../../stores/commandBus';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { pushWarningNotice } from '../../utils/statusNotice';
import { useAutoLogLanguage, useAutoRunGateCopy } from '../Editor/dockNotices';
import { loadCapsuleExporter } from '../Editor/runCapsuleExportLoader';
import { IconButton } from '../ui/chrome';
import { ICON_GLYPH } from '../ui/iconScale';

interface Row {
  id: string;
  icon: ReactNode;
  label: string;
  title?: string;
  tone?: 'warning';
  /** A state the row reports as on; it cannot be toggled from here. */
  checked?: boolean;
  run?: () => void;
}

/** The dock row's notices and run actions in one menu, for docks too narrow to show them inline. */
export function DockOverflowMenu() {
  const { t } = useTranslation();
  const hasTab = useEditorStore(state => getActiveTab(state) !== null);
  const gate = useAutoRunGateCopy();
  const autoLogLanguage = useAutoLogLanguage();
  const capsule = useExecutionHistoryStore(state => state.latestCapsule());

  const rows: Row[] = [];
  if (gate) {
    rows.push({ id: 'gate', icon: <PauseCircle size={ICON_GLYPH.md} />, label: gate.title, title: gate.description, tone: 'warning' });
  }
  if (autoLogLanguage !== null) {
    rows.push({
      id: 'auto-log',
      icon: <Check size={ICON_GLYPH.md} />,
      label: t('autoLog.statusPill.shortLabel'),
      checked: true,
      title: t('autoLog.statusPill.tooltip', { language: autoLogLanguage }),
    });
  }
  if (capsule) {
    rows.push({
      id: 'export-capsule',
      icon: <Package size={ICON_GLYPH.md} />,
      label: t('results.actions.exportCapsule.aria'),
      run: () => {
        loadCapsuleExporter()
          .then(module => module.exportCapsuleWithNotice(capsule))
          .catch((error: unknown) => {
            console.error('[run-capsule] failed to load the export pipeline', error);
            pushWarningNotice('results.actions.exportCapsule.loadFailed');
          });
      },
    });
  }
  if (hasTab) {
    rows.push({
      id: 'share',
      icon: <Share2 size={ICON_GLYPH.md} />,
      label: t('share.button.aria'),
      run: () => emitCommand('share.trigger', { trigger: 'button' }),
    });
  }
  // Unmounting the menu with its last row drops its open state.
  return rows.length > 0 ? <OverflowMenu rows={rows} /> : null;
}

function OverflowMenu({ rows }: { rows: Row[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Portaled: the dock's overflow-hidden ancestors would clip it in place.
  const position = useFloatingPosition(triggerRef, open, 'below');
  // A hidden menu cannot take focus, so keyboard handling starts once it is placed.
  useMenuKeyboard(open && position.visibility !== 'hidden', menuRef);
  const gate = rows.find(row => row.id === 'gate')?.label ?? null;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' && event.key !== 'Tab') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      triggerRef.current?.focus();
    }
    setOpen(false);
  };

  return (
    <>
      <IconButton
        ref={triggerRef}
        onClick={() => setOpen(value => !value)}
        tooltip={t('bottomPanel.actions.more')}
        tooltipSide="bottom"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="dock-more"
        className="relative"
      >
        <MoreHorizontal size={ICON_GLYPH.md} />
        {gate ? (
          <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warning" />
        ) : null}
      </IconButton>
      {gate ? (
        <span role="status" aria-live="polite" data-testid="auto-run-gate-notice" className="sr-only">
          {gate}
        </span>
      ) : null}
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={t('bottomPanel.actions.more')}
              data-testid="dock-more-menu"
              onKeyDown={onKeyDown}
              style={position}
              className="dropdown-rich z-[1000] w-max max-w-[calc(100vw-16px)]"
            >
              {rows.map(row => (
                <button
                  key={row.id}
                  type="button"
                  role={row.checked ? 'menuitemcheckbox' : 'menuitem'}
                  aria-checked={row.checked}
                  data-testid={`dock-more-${row.id}`}
                  aria-disabled={row.run ? undefined : true}
                  title={row.title}
                  onClick={() => {
                    if (!row.run) return;
                    setOpen(false);
                    triggerRef.current?.focus();
                    row.run();
                  }}
                  className={`dropdown-rich-row flex w-full items-center gap-3 text-left ${
                    row.tone === 'warning' ? 'text-warning' : ''
                  }`}
                >
                  <span aria-hidden="true" className="flex shrink-0">{row.icon}</span>
                  <span>{row.label}</span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
