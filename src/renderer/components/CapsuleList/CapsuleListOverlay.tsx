/**
 * Run capsules browser (⌘⌥C). Pro lists the session's capsules, own runs and
 * imported ones, with search, one result filter and a detail pane whose
 * primary action opens an inert tab. Free gets `CapsuleFreeGate`.
 *
 * Capsules live in memory only; the only mutations are Remove (with Undo)
 * and listing an import.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  Copy,
  File,
  FileDown,
  Files,
  FlaskConical,
  GitCompare,
  MoreHorizontal,
  Package,
  Search,
  Share,
  Trash2,
} from 'lucide-react';
import { CAPSULE_LRU_CAP, CAPSULE_LRU_CAP_PRO, useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useImportedCapsuleStore } from '../../stores/importedCapsuleStore';
import { emitCommand } from '../../stores/commandBus';
import { useUIStore } from '../../stores/uiStore';
import { useEntitlement, useEffectiveTier } from '../../hooks/useEntitlement';
import { summarizeRunCapsule, type RunCapsuleV1 } from '../../../shared/runCapsule';
import { exportCapsuleToClipboard } from '../../utils/exportCapsule';
import { exportCapsuleAsHtml } from '../../utils/exportCapsuleHtml';
import { openCapsuleSourceInNewTab } from '../../utils/openCapsuleTab';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { trackEvent } from '../../utils/telemetry';
import { cn } from '../../utils/cn';
import { ModalShell } from '../ui/ModalShell';
import { EmptyState } from '../ui/EmptyState';
import { CapsuleComparisonModal } from './CapsuleComparisonModal';
import { readCapsuleListSurfaceForMount } from './capsuleListSurface';
import { CapsuleWorkspaceExportDialog } from './CapsuleWorkspaceExportDialog';
import { CapsuleRegressionExportDialog } from './CapsuleRegressionExportDialog';
import { CapsuleActionMenu } from './CapsuleActionMenu';
import { CapsuleDialogHeader, CapsuleRowCells } from './CapsuleBrowserParts';
import { CapsuleDetail } from './CapsuleDetail';
import { CapsuleFreeGate, ImportButton } from './CapsuleFreeGate';
import {
  CAPSULE_ROW_GRID,
  buildCapsuleRows,
  filterCapsuleRows,
  orderForComparison,
  type CapsuleBrowserRow,
  type CapsuleResultFilter,
} from './capsuleBrowserRows';

export interface CapsuleListOverlayProps {
  onClose: () => void;
}

const FILTERS: ReadonlyArray<{ id: CapsuleResultFilter; labelKey: string }> = [
  { id: 'all', labelKey: 'capsuleList.filter.allStatuses' },
  { id: 'ok', labelKey: 'capsuleList.filter.statusOk' },
  { id: 'errors', labelKey: 'capsuleList.filter.statusError' },
];

const SECONDARY_BUTTON =
  'focus-ring inline-flex h-[34px] items-center gap-2 rounded-md border border-border-subtle bg-bg-panel px-3.5 text-body-sm font-medium text-fg-base hover:border-border-strong';

export function CapsuleListOverlay({ onClose }: CapsuleListOverlayProps) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const listId = useId();
  const canBrowse = useEntitlement('EXECUTION_HISTORY');
  const tier = useEffectiveTier();
  const pushStatusNotice = useUIStore((s) => s.pushStatusNotice);

  const history = useExecutionHistoryStore((s) => s.entries);
  const clearCapsule = useExecutionHistoryStore((s) => s.clearCapsule);
  const restoreCapsule = useExecutionHistoryStore((s) => s.restoreCapsule);
  const imported = useImportedCapsuleStore((s) => s.entries);
  const rows = useMemo(
    () => (canBrowse ? buildCapsuleRows(history, imported, CAPSULE_LRU_CAP_PRO) : buildCapsuleRows(history, [], CAPSULE_LRU_CAP)),
    [canBrowse, history, imported]
  );

  // Fires for Free and Pro so the upsell funnel stays measurable.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    void trackEvent('capsule.browse_opened', { surface: readCapsuleListSurfaceForMount('palette'), tier });
  }, [tier]);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CapsuleResultFilter>('all');
  const filtered = useMemo(() => filterCapsuleRows(rows, query, filter), [rows, query, filter]);

  // The pick falls back to the first visible row when a filter or a removal hides it.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const selected = useMemo(() => filtered.find((row) => row.id === pickedId) ?? filtered[0] ?? null, [filtered, pickedId]);

  const [comparePick, setCompareFrom] = useState<CapsuleBrowserRow | null>(null);
  // A pick whose capsule was removed is over.
  const compareFrom = comparePick && rows.some((row) => row.id === comparePick.id) ? comparePick : null;
  const listRef = useRef<HTMLDivElement>(null);
  const [comparePair, setComparePair] = useState<[RunCapsuleV1, RunCapsuleV1] | null>(null);
  const [regressionCapsule, setRegressionCapsule] = useState<RunCapsuleV1 | null>(null);
  const [workspaceCapsule, setWorkspaceCapsule] = useState<RunCapsuleV1 | null>(null);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!canBrowse || rows.length === 0) return;
    const handle = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(handle);
  }, [canBrowse, rows.length]);

  const pickRow = useCallback(
    (row: CapsuleBrowserRow) => {
      if (compareFrom && row.id !== compareFrom.id) {
        const pair = orderForComparison(compareFrom, row);
        setComparePair(pair);
        setCompareFrom(null);
        void trackEvent('capsule.compared', { sameLanguage: pair[0].tab.language === pair[1].tab.language });
        return;
      }
      setPickedId(row.id);
    },
    [compareFrom]
  );

  // Escape leaves the compare pick before it can close the dialog.
  const onBodyKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !compareFrom) return;
    event.preventDefault();
    event.stopPropagation();
    setCompareFrom(null);
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (filtered.length === 0) return;
    const index = selected ? filtered.indexOf(selected) : -1;
    const next =
      event.key === 'ArrowDown' ? Math.min(index + 1, filtered.length - 1)
      : event.key === 'ArrowUp' ? Math.max(index - 1, 0)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? filtered.length - 1
      : null;
    if (next !== null) {
      event.preventDefault();
      setPickedId(filtered[next]!.id);
      document.getElementById(`${listId}-${filtered[next]!.id}`)?.scrollIntoView?.({ block: 'nearest' });
    } else if (event.key === 'Enter' && selected) {
      event.preventDefault();
      pickRow(selected);
    }
  };

  const handleImport = useCallback(() => emitCommand('capsule.openImport'), []);

  const handleUpgrade = useCallback(() => {
    pushUpsellNotice({ messageKey: 'upsell.freeCeilingReached', featureLabel: t('upsell.feature.capsuleBrowse') });
    void trackEvent('feature.blocked', { entitlement: 'execution-history', tier: 'free' });
  }, [t]);

  const handleExport = useCallback(
    async (capsule: RunCapsuleV1) => {
      const result = await exportCapsuleToClipboard(capsule, 'list-export');
      pushStatusNotice(
        result.ok
          ? { tone: 'success', messageKey: 'settings.account.runCapsules.copiedNotice' }
          : { tone: 'warning', messageKey: 'results.actions.exportCapsule.clipboardUnavailable' }
      );
    },
    [pushStatusNotice]
  );

  const handleExportHtml = useCallback(
    async (capsule: RunCapsuleV1) => {
      await exportCapsuleAsHtml(capsule, 'list-export-html', {
        t,
        locale: i18n.language,
        onOk: () => pushStatusNotice({ tone: 'success', messageKey: 'capsuleHtml.notice.saved' }),
        onError: () => pushStatusNotice({ tone: 'error', messageKey: 'capsuleHtml.notice.failed' }),
      });
    },
    [i18n.language, pushStatusNotice, t]
  );

  const handleCopySummary = useCallback(
    async (capsule: RunCapsuleV1) => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(summarizeRunCapsule(capsule));
        pushStatusNotice({ tone: 'success', messageKey: 'capsuleList.notice.summaryCopied' });
      } catch {
        pushStatusNotice({ tone: 'warning', messageKey: 'capsuleImport.notice.copyFailed' });
      }
    },
    [pushStatusNotice]
  );

  const handleOpen = useCallback(
    (capsule: RunCapsuleV1) => {
      openCapsuleSourceInNewTab(capsule);
      pushStatusNotice({ tone: 'success', messageKey: 'capsuleImport.notice.openedTab' });
      onClose();
    },
    [onClose, pushStatusNotice]
  );

  // Removing is recoverable, so it acts at once and offers Undo instead of confirming.
  const handleRemove = useCallback(
    (row: CapsuleBrowserRow) => {
      let undo: () => void;
      if (row.kind === 'run') {
        const runCompare = useExecutionHistoryStore.getState().entries.find((entry) => entry.id === row.id)?.runCompare;
        clearCapsule(row.id);
        undo = () => restoreCapsule(row.id, row.capsule, runCompare);
      } else {
        const store = useImportedCapsuleStore.getState();
        const index = store.entries.findIndex((entry) => entry.id === row.id);
        const entry = store.entries[index];
        store.remove(row.id);
        undo = () => {
          if (entry) useImportedCapsuleStore.getState().restore(entry, index);
        };
      }
      pushStatusNotice({
        tone: 'info',
        messageKey: 'capsuleList.notice.capsuleRemoved',
        actions: [{ labelKey: 'common.undo', onClick: undo }],
      });
    },
    [clearCapsule, restoreCapsule, pushStatusNotice]
  );

  if (!canBrowse) {
    return <CapsuleFreeGate runs={rows} onClose={onClose} onImport={handleImport} onUpgrade={handleUpgrade} />;
  }

  const capsule = selected?.capsule ?? null;

  return (
    <>
      <ModalShell
        size="max-w-[1220px]"
        onClose={onClose}
        labelledById={titleId}
        headerClose="button"
        closeLabel={t('capsuleList.overlay.close')}
        footer={false}
        bodyClassName="p-0"
        bodyMaxHeightClassName="h-[min(708px,calc(88vh-120px))]"
        header={<CapsuleDialogHeader titleId={titleId} trailing={<ImportButton onImport={handleImport} />} />}
      >
        {rows.length === 0 ? (
          <EmptyState
            className="py-16"
            icon={<Package size={18} aria-hidden="true" />}
            title={<span data-testid="capsule-list-empty">{t('capsuleList.empty.title')}</span>}
            description={t('capsuleList.empty.hint')}
          />
        ) : (
          <div onKeyDown={onBodyKeyDown} className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_minmax(340px,460px)] md:grid-rows-1">
            <div className="flex min-h-0 flex-col border-b border-border-subtle md:border-b-0 md:border-r">
              <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border-subtle px-5">
                <label className="flex h-8 w-full max-w-[300px] items-center gap-2 rounded-md border border-border-subtle bg-bg-inset px-2.5 text-body-sm focus-within:border-border-strong">
                  <Search size={13} aria-hidden="true" className="shrink-0 text-fg-subtle" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-label={t('capsuleList.search')}
                    placeholder={t('capsuleList.search')}
                    data-testid="capsule-list-search"
                    className="min-w-0 flex-1 bg-transparent text-fg-base placeholder:text-fg-subtle focus:outline-none"
                  />
                </label>
                <div className="flex-1" />
                <div role="group" aria-label={t('capsuleList.filter.label')} className="flex shrink-0 rounded-[7px] border border-border-subtle bg-bg-inset p-0.5">
                  {FILTERS.map(({ id, labelKey }) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={filter === id}
                      onClick={() => setFilter(id)}
                      data-testid={`capsule-list-filter-${id}`}
                      className={cn(
                        'focus-ring h-6 rounded-[5px] px-2.5 text-caption font-medium',
                        filter === id ? 'bg-bg-panel text-fg-base shadow-e1' : 'text-fg-muted hover:text-fg-base'
                      )}
                    >
                      {t(labelKey)}
                    </button>
                  ))}
                </div>
              </div>
              {compareFrom ? (
                <div data-testid="capsule-compare-picking" className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-accent/10 px-5 py-2 text-caption text-fg-base">
                  <GitCompare size={12} aria-hidden="true" className="shrink-0 text-accent-fg" />
                  <span className="min-w-0 flex-1 truncate">{t('capsuleList.compare.pick', { name: compareFrom.capsule.tab.name })}</span>
                  <button type="button" onClick={() => setCompareFrom(null)} data-testid="capsule-compare-cancel" className="focus-ring rounded px-1.5 text-fg-muted hover:text-fg-base">
                    {t('capsuleList.compare.cancel')}
                  </button>
                </div>
              ) : null}
              <div
                role="listbox"
                aria-label={t('capsuleList.rowsLabel')}
                ref={listRef}
                aria-activedescendant={selected ? `${listId}-${selected.id}` : undefined}
                tabIndex={0}
                onKeyDown={onListKeyDown}
                data-testid="capsule-list-rows"
                className="focus-ring min-h-0 flex-1 overflow-auto focus-visible:ring-inset"
              >
                {filtered.map((row) => {
                  const isSelected = row.id === selected?.id;
                  return (
                    <div
                      key={row.id}
                      id={`${listId}-${row.id}`}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => pickRow(row)}
                      data-testid="capsule-list-row"
                      data-kind={row.kind}
                      data-selected={isSelected ? 'true' : 'false'}
                      className={cn(
                        CAPSULE_ROW_GRID,
                        'h-[52px] cursor-pointer border-b border-border-subtle px-5',
                        isSelected ? 'bg-accent/10' : 'hover:bg-bg-panel-alt',
                        compareFrom?.id === row.id && 'opacity-50'
                      )}
                    >
                      <CapsuleRowCells row={row} now={now} />
                    </div>
                  );
                })}
                {filtered.length === 0 ? (
                  <p data-testid="capsule-list-filtered-empty" className="px-5 py-6 text-center text-caption text-fg-subtle">
                    {t('capsuleList.filter.noMatches')}
                  </p>
                ) : null}
              </div>
              <p className="flex h-10 shrink-0 items-center border-t border-border-subtle px-5 text-caption text-fg-subtle">
                {t('capsuleList.retention', { count: CAPSULE_LRU_CAP_PRO })}
              </p>
            </div>

            <div data-testid="capsule-list-preview-pane" className="flex min-h-0 flex-col">
              {capsule && selected ? (
                <>
                  <div className="min-h-0 flex-1 overflow-auto px-5 pt-[18px] pb-4">
                    <CapsuleDetail key={selected.id} capsule={capsule} />
                  </div>
                  <div className="flex h-16 shrink-0 items-center gap-2 border-t border-border-subtle px-5">
                    <button type="button" onClick={() => handleOpen(capsule)} data-testid="capsule-list-row-open" className="button-primary inline-flex h-[34px] items-center gap-2 px-[18px]">
                      <File size={12} aria-hidden="true" />
                      {t('capsuleList.action.open')}
                    </button>
                    <CapsuleActionMenu
                      label={t('capsuleList.action.share')}
                      triggerTestId="capsule-list-share"
                      triggerClassName={SECONDARY_BUTTON}
                      trigger={
                        <>
                          <Share size={12} aria-hidden="true" />
                          {t('capsuleList.action.share')}
                          <ChevronDown size={10} aria-hidden="true" />
                        </>
                      }
                      items={[
                        { id: 'export', label: t('capsuleList.row.export'), icon: <Copy size={13} aria-hidden="true" />, testid: 'capsule-list-row-export', onSelect: () => void handleExport(capsule) },
                        { id: 'export-html', label: t('capsuleList.row.exportHtml'), icon: <FileDown size={13} aria-hidden="true" />, testid: 'capsule-list-row-export-html', onSelect: () => void handleExportHtml(capsule) },
                        { id: 'copy-summary', label: t('capsuleList.row.copySummary'), icon: <Copy size={13} aria-hidden="true" />, testid: 'capsule-list-row-copy-summary', onSelect: () => void handleCopySummary(capsule) },
                      ]}
                    />
                    <div className="flex-1" />
                    <CapsuleActionMenu
                      label={t('capsuleList.action.more')}
                      align="right"
                      triggerTestId="capsule-list-more"
                      triggerClassName="focus-ring grid size-7 place-items-center rounded-md text-fg-subtle hover:bg-bg-panel-alt hover:text-fg-base"
                      trigger={<MoreHorizontal size={16} aria-hidden="true" />}
                      items={[
                        { id: 'compare', label: t('capsuleList.compare.action'), icon: <GitCompare size={13} aria-hidden="true" />, testid: 'capsule-compare-button', disabled: rows.length < 2, onSelect: () => {
                          setCompareFrom(selected);
                          listRef.current?.focus();
                        } },
                        { id: 'workspace', label: t('capsuleList.row.createWorkspace'), icon: <Files size={13} aria-hidden="true" />, testid: 'capsule-list-row-create-workspace', onSelect: () => setWorkspaceCapsule(capsule) },
                        { id: 'regression', label: t('capsuleRegression.action'), icon: <FlaskConical size={13} aria-hidden="true" />, testid: 'capsule-prepare-regression', onSelect: () => setRegressionCapsule(capsule) },
                        { id: 'remove', label: t('capsuleList.row.delete'), icon: <Trash2 size={13} aria-hidden="true" />, testid: 'capsule-list-row-delete', danger: true, onSelect: () => handleRemove(selected) },
                      ]}
                    />
                  </div>
                </>
              ) : (
                <div data-testid="capsule-list-preview-empty" className="grid flex-1 place-items-center text-fg-subtle" aria-hidden="true">
                  <Package size={20} />
                </div>
              )}
            </div>
          </div>
        )}
      </ModalShell>
      <CapsuleComparisonModal capsules={comparePair} onClose={() => setComparePair(null)} />
      <CapsuleRegressionExportDialog capsule={regressionCapsule} onClose={() => setRegressionCapsule(null)} />
      <CapsuleWorkspaceExportDialog capsule={workspaceCapsule} onClose={() => setWorkspaceCapsule(null)} />
    </>
  );
}
