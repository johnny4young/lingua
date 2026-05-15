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
import { Pin, PinOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useResultStore } from '../../stores/resultStore';
import {
  diffSnapshot,
  resolveCompareTargetSnapshot,
} from '../../utils/snapshotDiff';
import type { DiffGranularity } from '../../utils/diff';

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

  if (relevantRing.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <span
          className="text-xs italic text-muted"
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

  const now = Date.now();
  const ringOptions = [...relevantRing].sort(
    (a, b) => b.capturedAt - a.capturedAt
  );

  return (
    <div className="flex h-full flex-col" data-testid="compare-results-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-4 py-2">
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span className="font-semibold uppercase tracking-[0.04em]">
            {t('compare.panel.title')}
          </span>
          {ringOptions.length > 1 && (
            <label className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className="sr-only">{t('compare.target.selectLabel')}</span>
              <select
                aria-label={t('compare.target.selectLabel')}
                data-testid="compare-target-select"
                value={targetEntry.capturedAt}
                onChange={(event) =>
                  setCompareTarget(Number(event.target.value))
                }
                className="rounded-md border border-border/60 bg-background/70 px-2 py-0.5 text-[11px] text-foreground outline-none focus:border-primary/40"
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
          <label className="flex items-center gap-1.5 text-[11px] text-muted">
            <span>{t('compare.granularity.label')}</span>
            <select
              aria-label={t('compare.granularity.label')}
              data-testid="compare-granularity"
              value={granularity}
              onChange={(event) =>
                setGranularity(event.target.value as DiffGranularity)
              }
              className="rounded-md border border-border/60 bg-background/70 px-2 py-0.5 text-[11px] text-foreground outline-none focus:border-primary/40"
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
            className="text-xs italic text-muted"
            data-testid="compare-empty-identical"
          >
            {t('compare.panel.empty.identical')}
          </span>
        </div>
      ) : diff.mode === 'dynamic' ? (
        <div className="flex-1 overflow-y-auto px-4 py-2" data-testid="compare-rows">
          <table className="w-full border-separate border-spacing-y-1 font-mono text-[11px]">
            <thead className="text-left text-[10px] uppercase tracking-[0.06em] text-muted">
              <tr>
                <th className="w-12 px-2">{t('compare.row.line')}</th>
                <th className="px-2">{t('compare.row.previous')}</th>
                <th className="px-2">{t('compare.row.current')}</th>
              </tr>
            </thead>
            <tbody>
              {diff.rows.map((row) => {
                const tone =
                  row.kind === 'added'
                    ? 'bg-success/10'
                    : row.kind === 'removed'
                      ? 'bg-danger/10'
                      : row.kind === 'changed'
                        ? 'bg-primary-soft'
                        : '';
                return (
                  <tr
                    key={`${row.kind}-${row.line}`}
                    data-testid={`compare-row-${row.kind}`}
                    className={tone}
                  >
                    <td className="rounded-l-md px-2 py-1 text-muted">
                      {row.line}
                    </td>
                    <td className="whitespace-pre-wrap break-words px-2 py-1 text-muted line-through opacity-80">
                      {row.previous ?? ''}
                    </td>
                    <td className="rounded-r-md whitespace-pre-wrap break-words px-2 py-1 text-foreground">
                      {row.current ?? ''}
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
                  ? 'bg-success/10 text-success'
                  : segment.kind === 'remove'
                    ? 'bg-danger/10 text-danger'
                    : 'text-foreground';
              return (
                <li
                  key={`${segment.kind}-${index}`}
                  data-testid={`compare-segment-${segment.kind}`}
                  className={`flex items-baseline gap-2 px-2 py-1 ${tone}`}
                >
                  <span className="w-3 select-none text-muted">{prefix}</span>
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
