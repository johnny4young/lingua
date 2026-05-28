/**
 * RL-094 Slice 3 — Capsule browse overlay.
 *
 * A Pro-gated master/detail surface over the in-memory run capsules
 * the execution-history store retains (`capsuleEntries()` — the newest
 * `resolveCapsuleCap()` entries that carry a `lastCapsule`). Slices 1
 * / 1.5 / 2 only let the user export the LATEST capsule or import an
 * external one; this overlay finally lets them browse, preview and
 * export ANY retained capsule.
 *
 * Layout:
 *   - Header: title + count chip + close.
 *   - Free tier: an upsell card instead of the list (mirror of
 *     `RecentRunsPill` fold E). The `capsule.browse_opened` telemetry
 *     still fires so the upsell funnel is measurable (fold G).
 *   - Pro tier: filter chips (language + status — fold C) over a
 *     two-pane grid: left = scrollable capsule rows with per-row
 *     actions (Preview / Export / Open in tab / Copy summary / Delete
 *     — folds B + D), right = `<CapsuleImportPreview>` of the selected
 *     capsule (reused verbatim — pure, no side effects).
 *
 * Capsules are in-memory only and never persisted, so a reload empties
 * the list until the next run. No new IPC, no disk writes; the only
 * mutation is fold B's per-row Delete which strips `lastCapsule` from
 * one history entry.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Copy, ExternalLink, Eye, Trash2, X } from 'lucide-react';
import {
  useExecutionHistoryStore,
  type ExecutionHistoryEntry,
} from '../../stores/executionHistoryStore';
import { useUIStore } from '../../stores/uiStore';
import { useEntitlement, useEffectiveTier } from '../../hooks/useEntitlement';
import { summarizeRunCapsule, utf8ByteLength } from '../../../shared/runCapsule';
import { exportCapsuleToClipboard } from '../../utils/exportCapsule';
import { openCapsuleSourceInNewTab } from '../../utils/openCapsuleTab';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { trackEvent } from '../../utils/telemetry';
import { cn } from '../../utils/cn';
import { CapsuleImportPreview } from '../CapsuleImport';
import { readCapsuleListSurfaceForMount } from './capsuleListSurface';

export interface CapsuleListOverlayProps {
  onClose: () => void;
}

/** Status filter chip values. `all` disables the status predicate. */
type StatusFilter = 'all' | 'ok' | 'error';

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
  const { t } = useTranslation();
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
  const capsuleEntries = useMemo<readonly ExecutionHistoryEntry[]>(() => {
    const out: ExecutionHistoryEntry[] = [];
    for (let i = allEntries.length - 1; i >= 0; i -= 1) {
      const entry = allEntries[i]!;
      if (entry.lastCapsule !== undefined) out.push(entry);
    }
    return out;
  }, [allEntries]);

  // ─── Telemetry on mount (fold G) — fires for Free + Pro so the
  // upsell funnel is measurable. Once per mount via a ref guard.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    const surface = readCapsuleListSurfaceForMount('palette');
    void trackEvent('capsule.browse_opened', { surface, tier });
  }, [tier]);

  // ─── Escape to close ─────────────────────────────────────────────
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  // ─── Filters (fold C) ────────────────────────────────────────────
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
  // Reviewer fix (RL-094 Slice 3): memoize the preview byte count on the
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
      clearCapsule(entry.id);
      pushStatusNotice({
        tone: 'success',
        messageKey: 'capsuleList.notice.capsuleRemoved',
      });
    },
    [clearCapsule, pushStatusNotice]
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
      <OverlayShell
        title={t('capsuleList.overlay.title')}
        subtitle={t('capsuleList.overlay.subtitle')}
        onClose={onClose}
        testid="capsule-list-overlay"
      >
        <div
          data-testid="capsule-list-upsell"
          className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/40 bg-surface/20 p-8 text-center"
        >
          <Archive size={28} className="text-muted" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-foreground">
            {t('capsuleList.upsell.title')}
          </h3>
          <p className="max-w-[42ch] text-xs text-muted">
            {t('capsuleList.upsell.body')}
          </p>
          <button
            type="button"
            onClick={handleUpgrade}
            data-testid="capsule-list-upsell-cta"
            className="rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/20"
          >
            {t('capsuleList.upsell.cta')}
          </button>
        </div>
      </OverlayShell>
    );
  }

  return (
    <OverlayShell
      title={t('capsuleList.overlay.title')}
      subtitle={t('capsuleList.overlay.subtitle')}
      onClose={onClose}
      testid="capsule-list-overlay"
      count={capsuleEntries.length}
    >
      {capsuleEntries.length === 0 ? (
        <div
          data-testid="capsule-list-empty"
          className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/40 bg-surface/20 p-6 text-center text-xs text-muted"
        >
          <p className="text-foreground">{t('capsuleList.empty.title')}</p>
          <p>{t('capsuleList.empty.hint')}</p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] gap-3">
          {/* Filter chips (fold C) */}
          <div
            data-testid="capsule-list-filters"
            className="flex flex-wrap items-center gap-1.5 text-[11px]"
          >
            <FilterChip
              active={languageFilter === 'all'}
              onClick={() => setLanguageFilter('all')}
              testid="capsule-list-filter-language-all"
            >
              {t('capsuleList.filter.allLanguages')}
            </FilterChip>
            {languages.map((lang) => (
              <FilterChip
                key={lang}
                active={languageFilter === lang}
                onClick={() => setLanguageFilter(lang)}
                testid={`capsule-list-filter-language-${lang}`}
              >
                {lang}
              </FilterChip>
            ))}
            <span className="mx-1 h-3.5 w-px bg-border/50" aria-hidden="true" />
            <FilterChip
              active={statusFilter === 'all'}
              onClick={() => setStatusFilter('all')}
              testid="capsule-list-filter-status-all"
            >
              {t('capsuleList.filter.allStatuses')}
            </FilterChip>
            <FilterChip
              active={statusFilter === 'ok'}
              onClick={() => setStatusFilter('ok')}
              testid="capsule-list-filter-status-ok"
            >
              {t('capsuleList.filter.statusOk')}
            </FilterChip>
            <FilterChip
              active={statusFilter === 'error'}
              onClick={() => setStatusFilter('error')}
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
                return (
                  <li key={entry.id}>
                    <div
                      data-testid="capsule-list-row"
                      data-selected={isSelected ? 'true' : 'false'}
                      className={cn(
                        'rounded-md border px-2.5 py-2 text-xs transition-colors',
                        isSelected
                          ? 'border-border-strong bg-surface-strong/50'
                          : 'border-border/50 bg-surface/30 hover:bg-surface-strong/40'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedId(entry.id)}
                        data-testid="capsule-list-row-select"
                        className="block w-full text-left"
                      >
                        <span className="flex items-center gap-2">
                          <span className="rounded bg-surface-strong/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-foreground">
                            {capsule.tab.language}
                          </span>
                          <span
                            className={cn(
                              'font-mono text-[10px] uppercase',
                              entry.status === 'ok'
                                ? 'text-emerald-300'
                                : 'text-rose-300'
                            )}
                          >
                            {entry.status}
                          </span>
                          <span className="ml-auto font-mono text-[10px] text-muted">
                            {formatRelative(entry.timestamp, now, t)}
                          </span>
                        </span>
                        <span className="mt-1 block truncate text-[11px] text-muted">
                          {summarizeRunCapsule(capsule)}
                        </span>
                      </button>
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
                  className="rounded-md border border-dashed border-border/40 px-3 py-4 text-center text-[11px] text-muted"
                >
                  {t('capsuleList.filter.noMatches')}
                </li>
              ) : null}
            </ul>

            {/* RIGHT — preview of the selected capsule */}
            <div className="min-h-0" data-testid="capsule-list-preview-pane">
              {selected?.lastCapsule ? (
                <CapsuleImportPreview
                  capsule={selected.lastCapsule}
                  byteLength={previewByteLength}
                />
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border/40 bg-surface/20 p-6 text-center text-xs text-muted">
                  {t('capsuleList.preview.placeholder')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </OverlayShell>
  );
}

function OverlayShell({
  title,
  subtitle,
  onClose,
  testid,
  count,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  testid: string;
  count?: number;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testid}
      className="fixed inset-0 z-40 flex items-start justify-center bg-bg-base/80 p-6 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mt-12 flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-xl">
        <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-base font-semibold tracking-[-0.01em] text-foreground">
              {title}
              {typeof count === 'number' ? (
                <span
                  data-testid="capsule-list-count"
                  className="rounded-full bg-surface-strong/60 px-2 py-0.5 text-[11px] font-medium text-muted"
                >
                  {t('capsuleList.count', { count })}
                </span>
              ) : null}
            </h2>
            <p className="mt-0.5 text-[11px] text-muted">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('capsuleList.overlay.close')}
            data-testid="capsule-list-overlay-close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-strong/60 hover:text-foreground"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col p-4">{children}</div>
      </div>
    </div>
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
        'rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide',
        active
          ? 'border-border-strong bg-surface-strong/60 text-foreground'
          : 'border-border/50 text-muted hover:bg-surface-strong/40'
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
        'inline-flex items-center justify-center rounded p-1 text-muted transition-colors',
        danger
          ? 'hover:bg-rose-500/15 hover:text-rose-200'
          : 'hover:bg-surface-strong/60 hover:text-foreground'
      )}
    >
      {icon}
    </button>
  );
}
