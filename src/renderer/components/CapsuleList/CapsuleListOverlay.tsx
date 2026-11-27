/**
 * Run capsules browser (⌘⌥C). Each row answers with its run's numeral; the
 * newest own run leads under Your last run. Pro browses, compares and exports
 * every capsule, own runs and imported ones. Free opens and shares its last run
 * and sees the earlier ones locked below the gate card.
 *
 * Capsules live in memory only; the only mutations are Remove (with Undo)
 * and listing an import.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, GitCompare, Package, Search } from 'lucide-react';
import { CAPSULE_LRU_CAP, CAPSULE_LRU_CAP_PRO, useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useImportedCapsuleStore } from '../../stores/importedCapsuleStore';
import { emitCommand } from '../../stores/commandBus';
import { useUIStore } from '../../stores/uiStore';
import { useEntitlement, useEffectiveTier } from '../../hooks/useEntitlement';
import { summarizeRunCapsule, type RunCapsuleV1 } from '../../../shared/runCapsule';
import { exportCapsuleToClipboard } from '../../utils/exportCapsule';
import { exportCapsuleAsHtml } from '../../utils/exportCapsuleHtml';
import { openCapsuleSourceInNewTab } from '../../utils/openCapsuleTab';
import { trackEvent } from '../../utils/telemetry';
import { cn } from '../../utils/cn';
import { ModalShell } from '../ui/ModalShell';
import { EmptyState } from '../ui/EmptyState';
import { ProMark } from '../ui/ProChip';
import { TypeTag } from '../ui/answer';
import { setPendingCapsuleImportFile } from '../../clipboard/pendingCapsuleImport';
import { CapsuleComparisonModal } from './CapsuleComparisonModal';
import { readCapsuleListSurfaceForMount } from './capsuleListSurface';
import { CapsuleWorkspaceExportDialog } from './CapsuleWorkspaceExportDialog';
import { CapsuleRegressionExportDialog } from './CapsuleRegressionExportDialog';
import { CapsuleDetailActions } from './CapsuleDetailActions';
import { CapsuleDialogHeader, CapsuleImportStrip, CapsuleListShortcut, CapsuleRowCells, ImportButton } from './CapsuleBrowserParts';
import { CapsuleDetail } from './CapsuleDetail';
import { CapsuleFreeGate } from './CapsuleFreeGate';
import {
  buildCapsuleRows,
  filterCapsuleRows,
  orderForComparison,
  pinLastRun,
  type CapsuleBrowserRow,
  type CapsuleResultFilter,
} from './capsuleBrowserRows';
import '../../i18n/capsuleImportCatalog';
import './capsuleList.css';

export interface CapsuleListOverlayProps {
  onClose: () => void;
}

const FILTERS: ReadonlyArray<{ id: CapsuleResultFilter; labelKey: string }> = [
  { id: 'all', labelKey: 'capsuleList.filter.allStatuses' },
  { id: 'ok', labelKey: 'capsuleList.filter.statusOk' },
  { id: 'errors', labelKey: 'capsuleList.filter.statusError' },
];

const ROW = 'flex h-[52px] items-center gap-[9px] whitespace-nowrap border-t border-border-subtle px-3.5';

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
  // Pin before filtering so a search or filter can never promote an earlier run to the last one.
  const pinned = useMemo(() => pinLastRun(rows), [rows]);
  const { lastRunId } = pinned;
  const filtered = useMemo(() => filterCapsuleRows(pinned.rows, query, filter), [pinned, query, filter]);
  // Free opens only its last run; the earlier ones stay listed but locked.
  const [selectable, locked] = useMemo(
    () => (canBrowse ? [filtered, []] : [filtered.filter((row) => row.id === lastRunId), filtered.filter((row) => row.id !== lastRunId)]),
    [canBrowse, filtered, lastRunId]
  );

  // The pick falls back to the first visible row when a filter or a removal hides it.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const selected = useMemo(() => selectable.find((row) => row.id === pickedId) ?? selectable[0] ?? null, [selectable, pickedId]);
  // Your last run heads the newest own run only; the rest read as earlier.
  const lead = lastRunId !== null && selectable[0]?.id === lastRunId ? selectable[0] : null;
  const rest = lead ? selectable.slice(1) : selectable;

  // Below md the list and the detail take turns; wider, both show and this flag does nothing.
  const [detailOpen, setDetailOpen] = useState(false);
  const backRef = useRef<HTMLButtonElement>(null);

  const [comparePick, setCompareFrom] = useState<CapsuleBrowserRow | null>(null);
  // A pick whose capsule was removed is over.
  const compareFrom = comparePick && rows.some((row) => row.id === comparePick.id) ? comparePick : null;
  const listRef = useRef<HTMLDivElement>(null);
  const [comparePair, setComparePair] = useState<[RunCapsuleV1, RunCapsuleV1] | null>(null);
  const [regressionCapsule, setRegressionCapsule] = useState<RunCapsuleV1 | null>(null);
  const [workspaceCapsule, setWorkspaceCapsule] = useState<RunCapsuleV1 | null>(null);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (rows.length === 0) return;
    const handle = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(handle);
  }, [rows.length]);

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
      setDetailOpen(true);
    },
    [compareFrom]
  );

  // The list leaves the screen when the detail opens on its own, so focus follows to Back.
  useEffect(() => {
    if (detailOpen && backRef.current?.checkVisibility?.()) backRef.current.focus({ preventScroll: true });
  }, [detailOpen]);

  // Requested with the list's return to the screen; focused once it has rendered.
  const [listFocusRequest, setListFocusRequest] = useState(0);
  useEffect(() => {
    if (listFocusRequest > 0) listRef.current?.focus({ preventScroll: true });
  }, [listFocusRequest]);
  const showList = () => {
    setDetailOpen(false);
    setListFocusRequest((count) => count + 1);
  };

  // Escape leaves the compare pick, then a narrow detail, before it can close the dialog.
  const onBodyKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    if (compareFrom) {
      event.preventDefault();
      event.stopPropagation();
      setCompareFrom(null);
    } else if (detailOpen && backRef.current?.checkVisibility?.()) {
      event.preventDefault();
      event.stopPropagation();
      showList();
    }
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (selectable.length === 0) return;
    const index = selected ? selectable.indexOf(selected) : -1;
    const next =
      event.key === 'ArrowDown' ? Math.min(index + 1, selectable.length - 1)
      : event.key === 'ArrowUp' ? Math.max(index - 1, 0)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? selectable.length - 1
      : null;
    if (next !== null) {
      event.preventDefault();
      setPickedId(selectable[next]!.id);
      document.getElementById(`${listId}-${selectable[next]!.id}`)?.scrollIntoView?.({ block: 'nearest' });
    } else if (event.key === 'Enter' && selected) {
      event.preventDefault();
      pickRow(selected);
    }
  };

  const handleImport = useCallback(() => emitCommand('capsule.openImport'), []);
  const handleDropFile = useCallback((file: File) => {
    setPendingCapsuleImportFile(file);
    emitCommand('capsule.openImport');
  }, []);
  const openPlans = useCallback(() => emitCommand('plans.compare'), []);
  const cap = canBrowse ? CAPSULE_LRU_CAP_PRO : CAPSULE_LRU_CAP;

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
        const entry = useExecutionHistoryStore.getState().entries.find((candidate) => candidate.id === row.id);
        const runCompare = entry?.runCompare;
        const resultSummary = entry?.resultSummary;
        clearCapsule(row.id);
        undo = () => restoreCapsule(row.id, row.capsule, runCompare, resultSummary);
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

  const renderRow = (row: CapsuleBrowserRow) => {
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
          ROW,
          'cursor-pointer',
          isSelected ? 'bg-bg-panel-alt' : 'hover:bg-bg-panel-alt/60',
          compareFrom?.id === row.id && 'opacity-50'
        )}
      >
        <CapsuleRowCells row={row} now={now} />
      </div>
    );
  };

  const actions = selected ? (
    <CapsuleDetailActions
      canBrowse={canBrowse}
      canCompare={rows.length >= 2}
      onOpen={() => handleOpen(selected.capsule)}
      onCopyJson={() => void handleExport(selected.capsule)}
      onCopySummary={() => void handleCopySummary(selected.capsule)}
      onCompare={() => {
        setCompareFrom(selected);
        showList();
      }}
      onExportHtml={() => void handleExportHtml(selected.capsule)}
      onRegression={() => setRegressionCapsule(selected.capsule)}
      onRemove={() => {
        handleRemove(selected);
        showList();
      }}
      onPlans={openPlans}
    />
  ) : null;

  const workspaceHint = selected ? (
    <div data-testid="capsule-workspace-hint" className="mx-5 mb-4 flex items-center gap-3 rounded-[10px] border border-border-subtle px-3.5 py-3 text-body-sm leading-[17px] text-fg-muted">
      <Package size={18} aria-hidden="true" className="shrink-0 text-fg-base" />
      <span>
        {t('capsuleList.workspaceHint.before')}{' '}
        <button
          type="button"
          onClick={canBrowse ? () => setWorkspaceCapsule(selected.capsule) : openPlans}
          data-testid="capsule-list-row-create-workspace"
          className="focus-ring inline-flex items-center gap-1.5 rounded-sm font-semibold text-fg-base underline-offset-2 hover:underline"
        >
          {t('capsuleList.row.createWorkspace')}
          {canBrowse ? null : <ProMark />}
        </button>{' '}
        {t('capsuleList.workspaceHint.after')}
      </span>
    </div>
  ) : null;

  return (
    <>
      <ModalShell
        size="max-w-[920px]"
        onClose={onClose}
        labelledById={titleId}
        headerClose="button"
        closeLabel={t('capsuleList.overlay.close')}
        bodyClassName="p-0"
        bodyMaxHeightClassName="h-[min(800px,calc(88vh-120px))]"
        header={<CapsuleDialogHeader titleId={titleId} trailing={<ImportButton onImport={handleImport} />} />}
        footerLegend={<span className="text-body-sm text-fg-muted">{t('capsuleList.retention', { count: cap })}</span>}
        trailing={<CapsuleListShortcut />}
      >
        <div
          onKeyDown={onBodyKeyDown}
          data-view={rows.length === 0 ? 'empty' : detailOpen ? 'detail' : 'list'}
          className="capsule-browser h-full min-h-0"
        >
          <div className="capsule-browser-list flex min-h-0 flex-col bg-bg-panel">
            <p className="px-3.5 pt-3.5 pb-2.5 text-body-sm leading-[17px] text-fg-muted">{t('capsuleList.definition')}</p>
            {rows.length > 0 ? (
              <div className="flex shrink-0 items-center gap-2 px-3.5 pb-2.5">
                <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[7px] border border-border-subtle px-2 text-body-sm focus-within:border-border-strong">
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
                <div role="group" aria-label={t('capsuleList.filter.label')} className="flex shrink-0 overflow-hidden rounded-md border border-border-subtle text-[11.5px]">
                  {FILTERS.map(({ id, labelKey }) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={filter === id}
                      onClick={() => setFilter(id)}
                      data-testid={`capsule-list-filter-${id}`}
                      className={cn(
                        'focus-ring whitespace-nowrap px-[9px] py-0.5 focus-visible:ring-inset',
                        filter === id ? 'bg-bg-panel-alt text-fg-base' : 'text-fg-subtle hover:text-fg-base'
                      )}
                    >
                      {t(labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {compareFrom ? (
              <div data-testid="capsule-compare-picking" className="flex shrink-0 items-center gap-3 border-t border-border-subtle bg-accent/10 px-3.5 py-2 text-caption text-fg-base">
                <GitCompare size={12} aria-hidden="true" className="shrink-0 text-accent-fg" />
                <span className="min-w-0 flex-1 truncate">{t('capsuleList.compare.pick', { name: compareFrom.capsule.tab.name })}</span>
                <button type="button" onClick={() => setCompareFrom(null)} data-testid="capsule-compare-cancel" className="focus-ring rounded px-1.5 text-fg-muted hover:text-fg-base">
                  {t('capsuleList.compare.cancel')}
                </button>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-auto">
              {rows.length > 0 ? (
                <div
                  role="listbox"
                  aria-label={t('capsuleList.rowsLabel')}
                  ref={listRef}
                  aria-activedescendant={selected ? `${listId}-${selected.id}` : undefined}
                  tabIndex={0}
                  onKeyDown={onListKeyDown}
                  data-testid="capsule-list-rows"
                  className="focus-ring focus-visible:ring-inset"
                >
                  {lead ? (
                    <div role="group" aria-labelledby={`${listId}-last`} data-testid="capsule-list-group-last">
                      <div id={`${listId}-last`} className="flex h-6 items-center px-3.5">
                        <TypeTag>{t('capsuleList.gate.lastRun')}</TypeTag>
                      </div>
                      {renderRow(lead)}
                    </div>
                  ) : null}
                  {lead && rest.length > 0 ? (
                    <div role="group" aria-labelledby={`${listId}-earlier`} data-testid="capsule-list-group-earlier">
                      <div id={`${listId}-earlier`} className="flex h-7 items-end border-t border-border-subtle px-3.5 pb-1">
                        <TypeTag>{t('capsuleList.group.earlier')}</TypeTag>
                      </div>
                      {rest.map(renderRow)}
                    </div>
                  ) : (
                    rest.map(renderRow)
                  )}
                </div>
              ) : null}
              {canBrowse ? null : <CapsuleFreeGate kept={rows.length} earlier={locked.length} />}
              {locked.length > 0 ? (
                <ul aria-label={t('capsuleList.lockedLabel')} data-testid="capsule-list-locked">
                  {locked.map((row) => (
                    <li key={row.id} aria-disabled="true" data-testid="capsule-list-row-locked" className={ROW}>
                      <CapsuleRowCells row={row} now={now} locked />
                    </li>
                  ))}
                </ul>
              ) : null}
              {rows.length > 0 && filtered.length === 0 ? (
                <p data-testid="capsule-list-filtered-empty" className="px-3.5 py-6 text-center text-caption text-fg-subtle">
                  {t('capsuleList.filter.noMatches')}
                </p>
              ) : null}
            </div>
            <CapsuleImportStrip onImport={handleImport} onDropFile={handleDropFile} />
          </div>

          <div data-testid="capsule-list-preview-pane" className="capsule-browser-detail flex min-h-0 flex-col bg-bg-base">
            {rows.length > 0 ? (
              <button ref={backRef} type="button" onClick={showList} data-testid="capsule-detail-back" className="capsule-browser-back focus-ring">
                <ChevronLeft size={14} aria-hidden="true" />
                {t('capsuleList.detail.back')}
              </button>
            ) : null}
            {rows.length === 0 ? (
              <EmptyState
                className="m-auto py-16"
                icon={<Package size={18} aria-hidden="true" />}
                title={<span data-testid="capsule-list-empty">{t('capsuleList.empty.title')}</span>}
                description={t('capsuleList.empty.hint')}
              />
            ) : selected ? (
              <CapsuleDetail key={selected.id} row={selected} now={now} actions={actions} footer={workspaceHint} />
            ) : (
              <div data-testid="capsule-list-preview-empty" className="grid flex-1 place-items-center text-fg-subtle" aria-hidden="true">
                <Package size={20} />
              </div>
            )}
          </div>
        </div>
      </ModalShell>
      <CapsuleComparisonModal capsules={comparePair} onClose={() => setComparePair(null)} />
      <CapsuleRegressionExportDialog capsule={regressionCapsule} onClose={() => setRegressionCapsule(null)} />
      <CapsuleWorkspaceExportDialog capsule={workspaceCapsule} onClose={() => setWorkspaceCapsule(null)} />
    </>
  );
}
