/**
 * RL-020 Slice 8 — Compare body. Renders the diff between the
 * latest stable run (`lastSuccessfulSnapshot`) and the current
 * result-store output. Mounted by `ResultPanel.tsx` in place of
 * `<LineAlignedResults>` when the active tab's
 * `compareWithSnapshotEnabled === true` AND the snapshot's
 * language matches.
 *
 * Two render modes (decided by `diffSnapshot`):
 *
 *   - **dynamic**: three columns — `Line` / `Previous` / `Current`.
 *     Rows colored by `kind` (added / removed / changed / unchanged).
 *   - **compiled**: a single-column unified diff (reuses the
 *     `DiffUtilityPanel` row shape style with `+ / − / ` prefixes).
 *
 * Fold B — the header surfaces a small `<select>` to pick a
 * comparator from the snapshot ring. Default target is the newest
 * entry; the user can step back through up to 3 prior runs. The
 * pin button (fold F) lives next to each entry so the user can
 * lock a known-good snapshot.
 *
 * Fold E — the granularity selector lives at the top of the
 * compiled mode (Line / Word / Character). Dynamic mode is always
 * line-keyed, so the selector is hidden there.
 */

import { useMemo, useState } from 'react';
import { GitCompare, Pin, PinOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useResultStore } from '../../stores/resultStore';
import {
  diffSnapshot,
  resolveCompareTargetSnapshot,
} from '../../utils/snapshotDiff';
import type { DiffGranularity } from '../../utils/diff';
import { EyebrowMono, MonoBadge, TypePill } from '../ui/primitives';
import { cn } from '../../utils/cn';

export interface CompareResultsPanelProps {
  language: string;
}

function formatRelativeMs(
  now: number,
  capturedAt: number,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const deltaMs = Math.max(0, now - capturedAt);
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 5) return t('compare.time.justNow');
  if (seconds < 60) return t('compare.time.secondsAgo', { seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('compare.time.minutesAgo', { minutes });
  const hours = Math.floor(minutes / 60);
  return t('compare.time.hoursAgo', { hours });
}

export function CompareResultsPanel({ language }: CompareResultsPanelProps) {
  const { t } = useTranslation();
  const snapshotRing = useResultStore((state) => state.snapshotRing);
  const selectedCapturedAt = useResultStore(
    (state) => state.selectedCompareTargetCapturedAt
  );
  const setCompareTarget = useResultStore((state) => state.setCompareTarget);
  const toggleSnapshotPin = useResultStore((state) => state.toggleSnapshotPin);
  const lineResults = useResultStore((state) => state.lineResults);
  const fullOutput = useResultStore((state) => state.fullOutput);
  const [granularity, setGranularity] = useState<DiffGranularity>('line');

  // Only snapshots that match the current language are candidates.
  // The toggle button gates rendering at the parent, but the panel
  // also gates internally so a race window cannot leak a stale
  // diff.
  const relevantRing = useMemo(
    () => snapshotRing.filter((entry) => entry.language === language),
    [snapshotRing, language]
  );
  // Hoisted ABOVE the early return below so every render path runs
  // the same hook sequence (react-hooks/rules-of-hooks). Anchored to
  // capturedAt so the relative-time strings stay stable across renders.
  const ringOptions = useMemo(
    () => [...relevantRing].sort((a, b) => b.capturedAt - a.capturedAt),
    [relevantRing]
  );

  if (relevantRing.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <span
          className="rounded-full border border-border/70 bg-bg-panel-alt px-4 py-2 text-xs italic text-fg-muted"
          data-testid="compare-empty-no-snapshot"
        >
          {t('compare.panel.empty.noSnapshot')}
        </span>
      </div>
    );
  }

  const targetEntry =
    resolveCompareTargetSnapshot({
      snapshotRing,
      language,
      selectedCapturedAt,
      current: { lineResults, fullOutput },
    }) ?? relevantRing[relevantRing.length - 1]!;

  const diff = diffSnapshot({
    snapshot: targetEntry,
    current: { lineResults, fullOutput },
    granularity,
  });

  // RL-033 dep-sweep follow-up — Date.now() in render is a react-hooks/purity
  // violation. Use the newest snapshot's capturedAt as the reference time so
  // the "X min ago" labels stay stable across renders.
  const now = ringOptions[0]?.capturedAt ?? targetEntry.capturedAt;

  return (
    <div className="flex h-full flex-col bg-bg-base" data-testid="compare-results-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-bg-panel-alt/65 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-fg-muted">
          <GitCompare size={12} className="text-accent-fg" aria-hidden />
          <EyebrowMono>{t('compare.panel.title')}</EyebrowMono>
          <MonoBadge tone="accent">
            {ringOptions.length}
          </MonoBadge>
          {ringOptions.length > 1 && (
            <label className="flex items-center gap-1.5 text-[11px] text-fg-muted">
              <span className="sr-only">{t('compare.target.selectLabel')}</span>
              <select
                aria-label={t('compare.target.selectLabel')}
                data-testid="compare-target-select"
                value={targetEntry.capturedAt}
                onChange={(event) =>
                  setCompareTarget(Number(event.target.value))
                }
                className="rounded-full border border-border/60 bg-bg-panel px-2.5 py-1 text-[11px] text-fg-base outline-none focus:border-accent/50"
              >
                {ringOptions.map((entry, index) => (
                  <option key={entry.capturedAt} value={entry.capturedAt}>
                    {index === 0
                      ? t('compare.target.optionLatest', {
                          time: formatRelativeMs(now, entry.capturedAt, t),
                        })
                      : t('compare.target.optionPrior', {
                          time: formatRelativeMs(now, entry.capturedAt, t),
                          ordinal: index + 1,
                        })}
                    {entry.pinned ? t('compare.target.pinnedSuffix') : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => toggleSnapshotPin(targetEntry.capturedAt)}
            title={
              targetEntry.pinned
                ? t('compare.target.unpin')
                : t('compare.target.pin')
            }
            aria-label={
              targetEntry.pinned
                ? t('compare.target.unpin')
                : t('compare.target.pin')
            }
            data-testid="compare-target-pin"
            data-pinned={targetEntry.pinned === true}
            className={`inline-flex h-6 w-6 items-center justify-center rounded-md border border-transparent text-muted hover:border-border/60 hover:text-foreground ${
              targetEntry.pinned ? 'border-primary/30 text-primary' : ''
            }`}
          >
            {targetEntry.pinned ? <Pin size={11} /> : <PinOff size={11} />}
          </button>
        </div>
        {diff.mode === 'compiled' && (
          <label className="flex items-center gap-1.5 text-[11px] text-fg-muted">
            <span>{t('compare.granularity.label')}</span>
            <select
              aria-label={t('compare.granularity.label')}
              data-testid="compare-granularity"
              value={granularity}
              onChange={(event) =>
                setGranularity(event.target.value as DiffGranularity)
              }
              className="rounded-full border border-border/60 bg-bg-panel px-2.5 py-1 text-[11px] text-fg-base outline-none focus:border-accent/50"
            >
              <option value="line">{t('compare.granularity.line')}</option>
              <option value="word">{t('compare.granularity.word')}</option>
              <option value="character">
                {t('compare.granularity.character')}
              </option>
            </select>
          </label>
        )}
      </div>

      {diff.identical ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <span
            className="rounded-full border border-border/70 bg-bg-panel-alt px-4 py-2 text-xs italic text-fg-muted"
            data-testid="compare-empty-identical"
          >
            {t('compare.panel.empty.identical')}
          </span>
        </div>
      ) : diff.mode === 'dynamic' ? (
        // RL-093 polish #9 — dense, four-column comparison table.
        // Columns: line · before · after · Δ. The Δ column carries a
        // small chip indicating add/remove/change so the user gets a
        // glanceable signal even when before/after differ only by
        // whitespace. Rows are denser (single-row, no border-spacing
        // padding) and use left-border colour stripes instead of full
        // background fills so longer outputs stay readable.
        <div className="flex-1 overflow-y-auto" data-testid="compare-rows">
          <table className="w-full font-mono text-[11px]">
            <thead className="sticky top-0 z-10 bg-bg-panel-alt/95 text-left text-[9.5px] uppercase tracking-[0.12em] text-fg-subtle backdrop-blur">
              <tr>
                <th className="w-10 px-3 py-1.5 font-semibold">{t('compare.row.line')}</th>
                <th className="px-2 py-1.5 font-semibold">{t('compare.row.before')}</th>
                <th className="px-2 py-1.5 font-semibold">{t('compare.row.after')}</th>
                <th className="w-12 px-2 py-1.5 text-right font-semibold">Δ</th>
              </tr>
            </thead>
            <tbody>
              {diff.rows.map((row, idx) => {
                const stripe =
                  row.kind === 'added'
                    ? 'border-l-success'
                    : row.kind === 'removed'
                      ? 'border-l-error'
                      : row.kind === 'changed'
                        ? 'border-l-accent'
                        : 'border-l-transparent';
                const deltaChip =
                  row.kind === 'added'
                    ? { glyph: '+', tone: 'bg-success-bg/70 text-success-fg' }
                    : row.kind === 'removed'
                      ? { glyph: '−', tone: 'bg-error-bg/70 text-error-fg' }
                      : row.kind === 'changed'
                        ? { glyph: '~', tone: 'bg-primary-soft text-accent-fg' }
                        : { glyph: '·', tone: 'text-fg-subtle/60' };
                return (
                  <tr
                    key={`${row.kind}-${row.line}-${idx}`}
                    data-testid={`compare-row-${row.kind}`}
                    data-diff-kind={row.kind}
                    className={cn(
                      'align-top border-b border-border/30',
                      idx % 2 === 1 && 'bg-bg-panel-alt/35',
                    )}
                  >
                    <td
                      className={cn(
                        'border-l-2 px-3 py-1 text-right text-fg-subtle font-semibold tabular-nums',
                        stripe,
                      )}
                    >
                      {row.line}
                    </td>
                    <td className="whitespace-pre-wrap break-words px-2 py-1 text-fg-muted">
                      {row.previous !== null && row.previous !== undefined && row.previous !== '' ? (
                        <span className={row.kind === 'changed' || row.kind === 'removed' ? 'line-through opacity-80' : ''}>
                          {row.previous}
                        </span>
                      ) : (
                        <span className="text-fg-subtle/40">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-fg-base">
                      {row.current !== null && row.current !== undefined && row.current !== '' ? (
                        <span className="inline-flex max-w-full items-center gap-2">
                          <span className="whitespace-pre-wrap break-words">{row.current}</span>
                          <TypePill kind={row.type} />
                        </span>
                      ) : (
                        <span className="text-fg-subtle/40">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <span
                        className={cn(
                          'inline-flex h-5 w-6 items-center justify-center rounded-md text-[10px] font-bold tabular-nums',
                          deltaChip.tone,
                        )}
                        aria-label={row.kind}
                      >
                        {deltaChip.glyph}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="flex-1 overflow-y-auto px-4 py-2 font-mono text-[11px]"
          data-testid="compare-unified"
        >
          <ul className="grid">
            {diff.segments.map((segment, index) => {
              const prefix =
                segment.kind === 'add'
                  ? '+'
                  : segment.kind === 'remove'
                    ? '-'
                    : ' ';
          const tone =
                segment.kind === 'add'
                  ? 'bg-success-bg/45 text-success-fg'
                  : segment.kind === 'remove'
                    ? 'bg-error-bg/45 text-error-fg'
                    : 'text-fg-base';
              return (
                <li
                  key={`${segment.kind}-${index}`}
                  data-testid={`compare-segment-${segment.kind}`}
                  className={`flex items-baseline gap-2 rounded-md px-2 py-1 ${tone}`}
                >
                  <span className="w-3 select-none text-fg-subtle">{prefix}</span>
                  <span className="whitespace-pre-wrap break-words">
                    {segment.text || ' '}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
