/**
 * implementation — Capsule browse overlay.
 *
 * A Pro-gated master/detail surface over the in-memory run capsules
 * the execution-history store retains (`capsuleEntries()` — the newest
 * `resolveCapsuleCap()` entries that carry a `lastCapsule`). implementation
 * / 1.5 / 2 only let the user export the LATEST capsule or import an
 * external one; this overlay finally lets them browse, preview and
 * export ANY retained capsule.
 *
 * Layout (FASE 1 MOV.01 — now rendered inside the shared `ModalShell`):
 *   - Header (title variant): title + subtitle, with the shell's `x`
 *     close button (`headerClose="button"`). The count moves to the
 *     footer `trailing` slot; the legend rail shows just `esc close`
 *     since navigation here is click-driven, not ↑↓/↵.
 *   - Free tier: an upsell card instead of the list (mirror of
 *     `RecentRunsPill` implementation note). The `capsule.browse_opened` telemetry
 *     still fires so the upsell funnel is measurable (implementation note).
 *   - Pro tier: filter chips (language + status — implementation note) over a
 *     two-pane grid: left = scrollable capsule rows with per-row
 *     actions (Preview / Export / Open in tab / Copy summary / Delete
 *     — implementation note), right = `<CapsuleImportPreview>` of the selected
 *     capsule (reused verbatim — pure, no side effects).
 *
 * Capsules are in-memory only and never persisted, so a reload empties
 * the list until the next run. No new IPC, no disk writes; the only
 * mutation is implementation note's per-row Delete which strips `lastCapsule` from
 * one history entry.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, ExternalLink, Eye, FileDown, GitCompare, Package, Trash2 } from 'lucide-react';
import {
  useExecutionHistoryStore,
  type ExecutionHistoryEntry,
} from '../../stores/executionHistoryStore';
import { useUIStore } from '../../stores/uiStore';
import { useEntitlement, useEffectiveTier } from '../../hooks/useEntitlement';
import {
  summarizeRunCapsule,
  utf8ByteLength,
  type RunCapsuleV1,
} from '../../../shared/runCapsule';
import { exportCapsuleToClipboard } from '../../utils/exportCapsule';
import { exportCapsuleAsHtml } from '../../utils/exportCapsuleHtml';
import { openCapsuleSourceInNewTab } from '../../utils/openCapsuleTab';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { trackEvent } from '../../utils/telemetry';
import { cn } from '../../utils/cn';
import { ModalShell } from '../ui/ModalShell';
import { ModalFooterLegend } from '../ui/ModalFooterLegend';
import { StatusBadge } from '../ui/StatusBadge';
import { EmptyState } from '../ui/EmptyState';
import { CapsuleImportPreview } from '../CapsuleImport';
import { CapsuleComparisonModal } from './CapsuleComparisonModal';
import { readCapsuleListSurfaceForMount } from './capsuleListSurface';

export interface CapsuleListOverlayProps {
  onClose: () => void;
}

/** Status filter chip values. `all` disables the status predicate. */
type StatusFilter = 'all' | 'ok' | 'error';

/**
 * implementation — sort two capsule entries oldest → newest so the
 * comparison modal renders Older / Newer panes deterministically.
 * Mirror of `compareHistoryEntries` in `ExecutionHistoryPopover`:
 * timestamp first, then a stable `id` tie-break for entries captured in
 * the same millisecond (the store ids are monotonic per bucket).
 */
function compareCapsuleEntries(
  older: ExecutionHistoryEntry,
  newer: ExecutionHistoryEntry
): number {
  if (older.timestamp !== newer.timestamp) return older.timestamp - newer.timestamp;
  return older.id.localeCompare(newer.id);
}

function formatRelative(
  timestamp: number,
  now: number,
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  const diff = Math.max(0, now - timestamp);
  const seconds = Math.round(diff / 1000);
  if (seconds < 60) {
    return t('executionHistory.relative.seconds', { count: seconds });
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return t('executionHistory.relative.minutes', { count: minutes });
  }
  const hours = Math.round(minutes / 60);
  return t('executionHistory.relative.hours', { count: hours });
}

export function CapsuleListOverlay({ onClose }: CapsuleListOverlayProps) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const canBrowse = useEntitlement('EXECUTION_HISTORY');
  const tier = useEffectiveTier();
  const pushStatusNotice = useUIStore((s) => s.pushStatusNotice);

  // Subscribe to the stable `entries` ref and derive the capsule slice
  // in a `useMemo`. Selecting `capsuleEntries()` directly would return
  // a fresh array each snapshot and trip zustand v5's update loop —
  // the same caveat `RecentRunsPill` documents for `byTabId`.
  const allEntries = useExecutionHistoryStore((s) => s.entries);
  const clearCapsule = useExecutionHistoryStore((s) => s.clearCapsule);
  const restoreCapsule = useExecutionHistoryStore((s) => s.restoreCapsule);
  const capsuleEntries = useMemo<readonly ExecutionHistoryEntry[]>(() => {
    const out: ExecutionHistoryEntry[] = [];
    for (let i = allEntries.length - 1; i >= 0; i -= 1) {
      const entry = allEntries[i]!;
      if (entry.lastCapsule !== undefined) out.push(entry);
    }
    return out;
  }, [allEntries]);

  // ─── Telemetry on mount (implementation note) — fires for Free + Pro so the
  // upsell funnel is measurable. Once per mount via a ref guard.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    const surface = readCapsuleListSurfaceForMount('palette');
    void trackEvent('capsule.browse_opened', { surface, tier });
  }, [tier]);

  // ─── Filters (implementation note) ────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [languageFilter, setLanguageFilter] = useState<string>('all');
  const languages = useMemo<readonly string[]>(() => {
    const seen = new Set<string>();
    for (const entry of capsuleEntries) {
      if (entry.lastCapsule) seen.add(entry.lastCapsule.tab.language);
    }
    return [...seen];
  }, [capsuleEntries]);

  const filtered = useMemo<readonly ExecutionHistoryEntry[]>(() => {
    return capsuleEntries.filter((entry) => {
      if (statusFilter !== 'all' && entry.status !== statusFilter) return false;
      if (
        languageFilter !== 'all' &&
        entry.lastCapsule?.tab.language !== languageFilter
      ) {
        return false;
      }
      return true;
    });
  }, [capsuleEntries, statusFilter, languageFilter]);

  // ─── Compare selection (implementation note) ──────────────────────────────────
  // Mirror `ExecutionHistoryPopover`: a free-toggle multiselect whose
  // Compare action is gated at exactly two. We do NOT cap the set at two
  // — toggling is unconstrained and only `compareEnabled` enforces the
  // pair (matching the popover precedent and keeping the toggle UX
  // predictable). `comparePair` holds the [older, newer] tuple handed to
  // the modal once the user presses Compare.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [comparePair, setComparePair] = useState<[RunCapsuleV1, RunCapsuleV1] | null>(
    null
  );

  // ─── Selection (drives the right-hand preview) ───────────────────
  // Track the user's explicit pick, but DERIVE the effective selection
  // so a pick that filters out (filter change or delete) transparently
  // falls back to the first visible row — no setState-in-effect, no
  // stale-but-mounted preview.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const selected = useMemo(() => {
    if (pickedId) {
      const found = filtered.find((entry) => entry.id === pickedId);
      if (found) return found;
    }
    return filtered[0] ?? null;
  }, [filtered, pickedId]);
  const selectedId = selected?.id ?? null;
  const setSelectedId = setPickedId;
  // Reviewer fix : memoize the preview byte count on the
  // selected capsule. A capsule can carry up to ~2 MiB (1 MiB stdout +
  // 1 MiB stderr); without this, `JSON.stringify` + `utf8ByteLength` ran
  // on every render — including each 60s relative-timestamp tick below —
  // blocking the main thread for a value that only changes when the
  // selection changes.
  const previewByteLength = useMemo(
    () =>
      selected?.lastCapsule
        ? utf8ByteLength(JSON.stringify(selected.lastCapsule))
        : 0,
    [selected]
  );

  // ─── Compare derivations (implementation note) ────────────────────────────────
  // Only count selections that survive the current filter so a
  // filtered-out pick can never form a stale pair. Every capsule entry
  // carries a `lastCapsule`, so the predicate is just set-membership.
  const selectedEntries = useMemo(
    () => filtered.filter((entry) => selectedIds.has(entry.id)),
    [filtered, selectedIds]
  );
  const compareEnabled = selectedEntries.length === 2;

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Filter setters that ALSO clear the compare selection so a selection
  // made under one filter can't combine with one made under another into
  // a pair the user never saw side by side. Done imperatively in the
  // handler (mirror of `ExecutionHistoryPopover`'s reset hygiene) rather
  // than a setState-in-effect. Overlay-close reset is implicit — the
  // whole component unmounts.
  const changeStatusFilter = useCallback((next: StatusFilter) => {
    setStatusFilter(next);
    setSelectedIds(new Set());
  }, []);
  const changeLanguageFilter = useCallback((next: string) => {
    setLanguageFilter(next);
    setSelectedIds(new Set());
  }, []);

  const handleCompare = useCallback(() => {
    if (selectedEntries.length !== 2) return;
    // Sort oldest → newest so the modal renders Older / Newer panes
    // deterministically. Both entries are capsule entries, so
    // `lastCapsule` is defined on each.
    const [older, newer] = [...selectedEntries].sort(compareCapsuleEntries) as [
      ExecutionHistoryEntry,
      ExecutionHistoryEntry,
    ];
    const olderCapsule = older.lastCapsule;
    const newerCapsule = newer.lastCapsule;
    if (!olderCapsule || !newerCapsule) return;
    setComparePair([olderCapsule, newerCapsule]);
    void trackEvent('capsule.compared', {
      sameLanguage: olderCapsule.tab.language === newerCapsule.tab.language,
    });
  }, [selectedEntries]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!canBrowse || capsuleEntries.length === 0) return;
    const handle = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(handle);
  }, [canBrowse, capsuleEntries.length]);

  // ─── Per-row actions ─────────────────────────────────────────────
  const handleExport = useCallback(
    async (entry: ExecutionHistoryEntry) => {
      const capsule = entry.lastCapsule;
      if (!capsule) return;
      const result = await exportCapsuleToClipboard(capsule, 'list-export');
      pushStatusNotice(
        result.ok
          ? {
              tone: 'success',
              messageKey: 'settings.account.runCapsules.copiedNotice',
            }
          : {
              tone: 'warning',
              messageKey: 'results.actions.exportCapsule.clipboardUnavailable',
            }
      );
    },
    [pushStatusNotice]
  );

  // internal — per-row self-contained HTML export (native save dialog on
  // desktop, blob download on web). Outcome notices mirror handleExport.
  const handleExportHtml = useCallback(
    async (entry: ExecutionHistoryEntry) => {
      const capsule = entry.lastCapsule;
      if (!capsule) return;
      await exportCapsuleAsHtml(capsule, 'list-export-html', {
        t,
        locale: i18n.language,
        onOk: () =>
          pushStatusNotice({
            tone: 'success',
            messageKey: 'capsuleHtml.notice.saved',
          }),
        onError: () =>
          pushStatusNotice({
            tone: 'error',
            messageKey: 'capsuleHtml.notice.failed',
          }),
      });
    },
    [i18n.language, pushStatusNotice, t]
  );

  const handleCopySummary = useCallback(
    async (entry: ExecutionHistoryEntry) => {
      const capsule = entry.lastCapsule;
      if (!capsule) return;
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        pushStatusNotice({
          tone: 'warning',
          messageKey: 'capsuleImport.notice.copyFailed',
        });
        return;
      }
      try {
        await navigator.clipboard.writeText(summarizeRunCapsule(capsule));
        pushStatusNotice({
          tone: 'success',
          messageKey: 'capsuleList.notice.summaryCopied',
        });
      } catch {
        pushStatusNotice({
          tone: 'warning',
          messageKey: 'capsuleImport.notice.copyFailed',
        });
      }
    },
    [pushStatusNotice]
  );

  const handleOpenInTab = useCallback(
    (entry: ExecutionHistoryEntry) => {
      const capsule = entry.lastCapsule;
      if (!capsule) return;
      openCapsuleSourceInNewTab(capsule);
      pushStatusNotice({
        tone: 'success',
        messageKey: 'capsuleImport.notice.openedTab',
      });
      closeRef.current();
    },
    [pushStatusNotice]
  );

  const handleDelete = useCallback(
    (entry: ExecutionHistoryEntry) => {
      // accessibility pass — removing a capsule only strips `lastCapsule`
      // from a run row that stays in the history; it is fully
      // recoverable, so it deletes optimistically and offers an Undo
      // toast instead of confirming. Stash the capsule so Undo can
      // re-attach it to the same row (its array position never moved).
      const removed = entry.lastCapsule;
      clearCapsule(entry.id);
      pushStatusNotice({
        tone: 'info',
        messageKey: 'capsuleList.notice.capsuleRemoved',
        actions: removed
          ? [
              {
                labelKey: 'common.undo',
                onClick: () => {
                  // restoreCapsule no-ops if the row already has a
                  // capsule again, so a double-undo is harmless.
                  restoreCapsule(entry.id, removed);
                },
              },
            ]
          : undefined,
      });
    },
    [clearCapsule, restoreCapsule, pushStatusNotice]
  );

  const handleUpgrade = useCallback(() => {
    pushUpsellNotice({
      messageKey: 'upsell.freeCeilingReached',
      featureLabel: t('upsell.feature.capsuleBrowse'),
    });
    void trackEvent('feature.blocked', {
      entitlement: 'execution-history',
      tier: 'free',
    });
  }, [t]);

  // ─── Free-tier upsell variant ────────────────────────────────────
  if (!canBrowse) {
    return (
      <CapsuleShell
        titleId={titleId}
        onClose={onClose}
        footerTrailing={null}
      >
        <div data-testid="capsule-list-upsell">
          <EmptyState
            className="py-10"
            icon={<Package size={18} aria-hidden="true" />}
            title={t('capsuleList.upsell.title')}
            description={t('capsuleList.upsell.body')}
            action={
              <button
                type="button"
                onClick={handleUpgrade}
                data-testid="capsule-list-upsell-cta"
                className="button-primary"
              >
                {t('capsuleList.upsell.cta')}
              </button>
            }
          />
        </div>
      </CapsuleShell>
    );
  }

  return (
    <>
    <CapsuleShell
      titleId={titleId}
      onClose={onClose}
      footerTrailing={
        <div className="flex items-center gap-3">
          {capsuleEntries.length > 0 ? (
            <>
              <span
                data-testid="capsule-compare-hint"
                className="text-caption text-fg-subtle"
              >
                {compareEnabled ? null : t('capsule.compare.selectHint')}
              </span>
              <button
                type="button"
                onClick={handleCompare}
                disabled={!compareEnabled}
                data-testid="capsule-compare-button"
                aria-label={t('capsule.compare.action')}
                className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1 text-caption text-fg-muted transition-colors hover:border-border-strong hover:text-fg-base disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-border-subtle disabled:hover:text-fg-muted"
              >
                <GitCompare size={12} aria-hidden="true" />
                {t('capsule.compare.action')}
              </button>
            </>
          ) : null}
          <span
            data-testid="capsule-list-count"
            className="font-mono text-caption text-fg-subtle"
          >
            {t('capsuleList.count', { count: capsuleEntries.length })}
          </span>
        </div>
      }
    >
      {capsuleEntries.length === 0 ? (
        <EmptyState
          className="py-10"
          icon={<Package size={18} aria-hidden="true" />}
          title={
            <span data-testid="capsule-list-empty">
              {t('capsuleList.empty.title')}
            </span>
          }
          description={t('capsuleList.empty.hint')}
        />
      ) : (
        <div className="grid h-[min(56vh,400px)] min-h-0 grid-rows-[auto_1fr] gap-3">
          {/* Filter chips (implementation note) */}
          <div
            data-testid="capsule-list-filters"
            className="flex flex-wrap items-center gap-1.5 text-caption"
          >
            <FilterChip
              active={languageFilter === 'all'}
              onClick={() => changeLanguageFilter('all')}
              testid="capsule-list-filter-language-all"
            >
              {t('capsuleList.filter.allLanguages')}
            </FilterChip>
            {languages.map((lang) => (
              <FilterChip
                key={lang}
                active={languageFilter === lang}
                onClick={() => changeLanguageFilter(lang)}
                testid={`capsule-list-filter-language-${lang}`}
              >
                {lang}
              </FilterChip>
            ))}
            <span
              className="mx-1 h-3.5 w-px bg-border-subtle"
              aria-hidden="true"
            />
            <FilterChip
              active={statusFilter === 'all'}
              onClick={() => changeStatusFilter('all')}
              testid="capsule-list-filter-status-all"
            >
              {t('capsuleList.filter.allStatuses')}
            </FilterChip>
            <FilterChip
              active={statusFilter === 'ok'}
              onClick={() => changeStatusFilter('ok')}
              testid="capsule-list-filter-status-ok"
            >
              {t('capsuleList.filter.statusOk')}
            </FilterChip>
            <FilterChip
              active={statusFilter === 'error'}
              onClick={() => changeStatusFilter('error')}
              testid="capsule-list-filter-status-error"
            >
              {t('capsuleList.filter.statusError')}
            </FilterChip>
          </div>

          <div className="grid min-h-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            {/* LEFT — capsule rows */}
            <ul
              data-testid="capsule-list-rows"
              className="min-h-0 space-y-1.5 overflow-auto pr-1"
            >
              {filtered.map((entry) => {
                const capsule = entry.lastCapsule!;
                const isSelected = entry.id === selectedId;
                const isChecked = selectedIds.has(entry.id);
                return (
                  <li key={entry.id}>
                    <div
                      data-testid="capsule-list-row"
                      data-selected={isSelected ? 'true' : 'false'}
                      className={cn(
                        'rounded-md border px-2.5 py-2 text-body-sm transition-colors',
                        isSelected
                          ? 'border-border-strong bg-bg-panel-alt'
                          : 'border-border-subtle bg-bg-inset/40 hover:bg-bg-panel-alt'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {/* implementation note — compare multiselect. A real checkbox so
                            keyboard + screen-reader users can build the pair;
                            sits outside the row-select button (no nested
                            interactive controls). */}
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelected(entry.id)}
                          data-testid={`capsule-row-select-${entry.id}`}
                          aria-label={t('capsule.compare.checkbox.aria', {
                            language: capsule.tab.language,
                          })}
                          className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent"
                        />
                        <button
                          type="button"
                          onClick={() => setSelectedId(entry.id)}
                          data-testid="capsule-list-row-select"
                          className="block min-w-0 flex-1 text-left"
                        >
                          <span className="flex items-center gap-2">
                            <StatusBadge tone="neutral">
                              {capsule.tab.language}
                            </StatusBadge>
                            <StatusBadge
                              tone={entry.status === 'ok' ? 'success' : 'error'}
                            >
                              {entry.status}
                            </StatusBadge>
                            <span className="ml-auto font-mono text-eyebrow text-fg-subtle">
                              {formatRelative(entry.timestamp, now, t)}
                            </span>
                          </span>
                          <span className="mt-1 block truncate text-caption text-fg-subtle">
                            {summarizeRunCapsule(capsule)}
                          </span>
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-1">
                        <RowAction
                          icon={<Eye size={12} aria-hidden="true" />}
                          label={t('capsuleList.row.preview')}
                          testid="capsule-list-row-preview"
                          onClick={() => setSelectedId(entry.id)}
                        />
                        <RowAction
                          icon={<Copy size={12} aria-hidden="true" />}
                          label={t('capsuleList.row.export')}
                          testid="capsule-list-row-export"
                          onClick={() => void handleExport(entry)}
                        />
                        <RowAction
                          icon={<FileDown size={12} aria-hidden="true" />}
                          label={t('capsuleList.row.exportHtml')}
                          testid="capsule-list-row-export-html"
                          onClick={() => void handleExportHtml(entry)}
                        />
                        <RowAction
                          icon={<ExternalLink size={12} aria-hidden="true" />}
                          label={t('capsuleList.row.openInTab')}
                          testid="capsule-list-row-open"
                          onClick={() => handleOpenInTab(entry)}
                        />
                        <RowAction
                          icon={<Copy size={12} aria-hidden="true" />}
                          label={t('capsuleList.row.copySummary')}
                          testid="capsule-list-row-copy-summary"
                          onClick={() => void handleCopySummary(entry)}
                        />
                        <RowAction
                          icon={<Trash2 size={12} aria-hidden="true" />}
                          label={t('capsuleList.row.delete')}
                          testid="capsule-list-row-delete"
                          danger
                          onClick={() => handleDelete(entry)}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
              {filtered.length === 0 ? (
                <li
                  data-testid="capsule-list-filtered-empty"
                  className="rounded-md border border-dashed border-border-subtle px-3 py-4 text-center text-caption text-fg-subtle"
                >
                  {t('capsuleList.filter.noMatches')}
                </li>
              ) : null}
            </ul>

            {/* RIGHT — preview of the selected capsule */}
            <div
              className="min-h-0 overflow-auto"
              data-testid="capsule-list-preview-pane"
            >
              {selected?.lastCapsule ? (
                <CapsuleImportPreview
                  capsule={selected.lastCapsule}
                  byteLength={previewByteLength}
                />
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border-subtle bg-bg-inset/40 p-6 text-center text-body-sm text-fg-subtle">
                  {t('capsuleList.preview.placeholder')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </CapsuleShell>
    {/* implementation note — the comparator renders as a sibling so it layers above
        the list overlay. `comparePair` is null until the user presses
        Compare; closing it clears the pair but leaves the multiselect
        intact so they can adjust and re-compare. */}
    <CapsuleComparisonModal
      capsules={comparePair}
      onClose={() => setComparePair(null)}
    />
    </>
  );
}

/**
 * Thin wrapper over the shared `ModalShell` that fixes the capsule
 * overlay's invariant chrome: a TITLE-variant header (title + subtitle
 * with the shell's `x` close button), the `max-w-[720px]` clamp from the
 * MOV.01 prototype, and a footer whose legend is just `esc close`
 * (navigation here is click-driven, not ↑↓/↵) with the live count in the
 * trailing slot. Body padding stays at the shell default; the populated
 * grid manages its own internal scroll.
 */
function CapsuleShell({
  titleId,
  onClose,
  footerTrailing,
  children,
}: {
  titleId: string;
  onClose: () => void;
  footerTrailing: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <ModalShell
      size="max-w-[720px]"
      onClose={onClose}
      labelledById={titleId}
      headerClose="button"
      closeLabel={t('capsuleList.overlay.close')}
      header={
        <div data-testid="capsule-list-overlay">
          <div
            id={titleId}
            className="text-body-lg font-semibold tracking-[-0.01em] text-fg-base"
          >
            {t('capsuleList.overlay.title')}
          </div>
          <div className="mt-0.5 text-body-sm text-fg-subtle">
            {t('capsuleList.overlay.subtitle')}
          </div>
        </div>
      }
      footerLegend={<ModalFooterLegend navigate={false} select={false} close />}
      trailing={footerTrailing}
    >
      {children}
    </ModalShell>
  );
}

function FilterChip({
  active,
  onClick,
  testid,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testid: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      data-active={active ? 'true' : 'false'}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-2 py-0.5 font-mono text-eyebrow uppercase tracking-wide',
        active
          ? 'border-accent/40 bg-accent/10 text-accent-fg'
          : 'border-border-subtle bg-bg-inset text-fg-muted hover:text-fg-base'
      )}
    >
      {children}
    </button>
  );
}

function RowAction({
  icon,
  label,
  testid,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  testid: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex items-center justify-center rounded p-1 text-fg-subtle transition-colors',
        danger
          ? 'hover:bg-error-bg hover:text-error-fg'
          : 'hover:bg-bg-panel-alt hover:text-fg-base'
      )}
    >
      {icon}
    </button>
  );
}
