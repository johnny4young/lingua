import { Download, PanelLeftOpen, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShortcutLabel } from '../../hooks/useShortcutLabel';

const RAIL_BUTTON =
  'focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg-panel-alt hover:text-fg-base disabled:cursor-not-allowed disabled:opacity-40';

interface SqlExplorerRailProps {
  onUnfold: () => void;
  onCreate: () => void;
  onImport: () => void;
  isImportBusy: boolean;
}

/** The 44 px rail the Explorer folds to with Cmd/Ctrl+B. */
export function SqlExplorerRail({
  onUnfold,
  onCreate,
  onImport,
  isImportBusy,
}: SqlExplorerRailProps) {
  const { t } = useTranslation();
  const combo = useShortcutLabel('view-toggle-sidebar');
  const showLabel = combo
    ? t('sqlWorkspace.explorer.showWithShortcut', { combo })
    : t('sqlWorkspace.explorer.show');
  return (
    <nav
      data-testid="sql-explorer-rail"
      aria-label={t('sqlWorkspace.explorer.railAria')}
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border-subtle bg-bg-panel py-1.5"
    >
      <button
        type="button"
        onClick={onUnfold}
        aria-label={showLabel}
        title={showLabel}
        data-testid="sql-explorer-unfold"
        className={RAIL_BUTTON}
      >
        <PanelLeftOpen size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onCreate}
        aria-label={t('sqlWorkspace.queryList.newQuery')}
        title={t('sqlWorkspace.queryList.newQuery')}
        data-testid="sql-explorer-rail-create"
        className={RAIL_BUTTON}
      >
        <Plus size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onImport}
        disabled={isImportBusy}
        aria-label={t('sqlWorkspace.import.buttonAria')}
        title={t('sqlWorkspace.import.buttonAria')}
        data-testid="sql-explorer-rail-import"
        className={RAIL_BUTTON}
      >
        <Download size={14} aria-hidden="true" />
      </button>
    </nav>
  );
}
