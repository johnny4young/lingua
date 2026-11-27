import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, MoreHorizontal, Package, PauseCircle, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../../i18n/runMeterCatalog';
import { usePortalMenu } from '../../hooks/usePortalMenu';
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
      title: t(
        Array.isArray(capsule.result.richOutputs) && capsule.result.richOutputs.length > 0
          ? 'results.actions.exportCapsule.proBadge'
          : 'results.actions.exportCapsule.tooltip'
      ),
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
  if (rows.length === 0) return null;
  return (
    <>
      {/* Unmounting the menu with its last row drops its open state. */}
      <OverflowMenu rows={rows} />
      {gate ? (
        <span
          role="status"
          aria-live="polite"
          data-testid="auto-run-gate-notice"
          data-gate-variant={gate.variant}
          className="sr-only"
        >
          {gate.title}
        </span>
      ) : null}
    </>
  );
}

function OverflowMenu({ rows }: { rows: Row[] }) {
  const { t } = useTranslation();
  // Portaled: the dock's overflow-hidden ancestors would clip it in place.
  const { open, setOpen, triggerRef, menuRef, position, onMenuKeyDown, closeToTrigger } = usePortalMenu();
  const gated = rows.some(row => row.id === 'gate');

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
        {gated ? (
          <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warning" />
        ) : null}
      </IconButton>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={t('bottomPanel.actions.more')}
              data-testid="dock-more-menu"
              onKeyDown={onMenuKeyDown}
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
                    closeToTrigger();
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
