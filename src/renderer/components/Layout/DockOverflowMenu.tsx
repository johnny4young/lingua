import { Check, Package, PauseCircle, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../../i18n/runMeterCatalog';
import { emitCommand } from '../../stores/commandBus';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { pushWarningNotice } from '../../utils/statusNotice';
import { useAutoLogLanguage, useAutoRunGateCopy } from '../Editor/dockNotices';
import { loadCapsuleExporter } from '../Editor/runCapsuleExportLoader';
import { ICON_GLYPH } from '../ui/iconScale';
import { OverflowMenu, type OverflowMenuItem } from '../ui/OverflowMenu';

/** The dock row's notices and run actions in one menu, for docks too narrow to show them inline. */
export function DockOverflowMenu() {
  const { t } = useTranslation();
  const hasTab = useEditorStore(state => getActiveTab(state) !== null);
  const gate = useAutoRunGateCopy();
  const autoLogLanguage = useAutoLogLanguage();
  const capsule = useExecutionHistoryStore(state => state.latestCapsule());

  const rows: OverflowMenuItem[] = [];
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
      <OverflowMenu
        label={t('bottomPanel.actions.more')}
        items={rows}
        testId="dock-more"
        attention={Boolean(gate)}
        tooltipSide="bottom"
      />
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
