import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { type ExecutionHistoryEntry } from '../../stores/executionHistoryStore';
import {
  DIFF_MAX_INPUT_CHARS,
  summarizeDiff,
  type DiffSegment,
} from '../../utils/diff';
import { useComputedDiff } from '../../hooks/useComputedDiff';
import { IconButton, OverlayBackdrop, OverlayCard } from '../ui/chrome';

/**
 * implementation — read-only comparison modal for two execution-history
 * entries. Renders the captured `snapshot.code` of each entry side-by-side
 * with a line-by-line diff strip below the panes. Always opened with two
 * snapshot-bearing entries (the popover guards selection to non-null
 * snapshots), so this component does not handle the metadata-only case.
 *
 * `entries` is `[older, newer]` sorted by timestamp ascending, so the older
 * pane sits on the left (read order) and the newer pane on the right.
 */
export interface ExecutionComparisonModalProps {
  entries: [ExecutionHistoryEntry, ExecutionHistoryEntry] | null;
  onClose: () => void;
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '—';
  if (durationMs < 10) return `${durationMs.toFixed(1)} ms`;
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(2)} s`;
}

function formatDelta(olderMs: number | null, newerMs: number | null): string {
  if (olderMs === null || newerMs === null) return '—';
  const delta = newerMs - olderMs;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  const magnitude = Math.abs(delta);
  if (magnitude < 10) return `${sign}${magnitude.toFixed(1)} ms`;
  if (magnitude < 1000) return `${sign}${Math.round(magnitude)} ms`;
  return `${sign}${(magnitude / 1000).toFixed(2)} s`;
}

function DiffLine({ segment }: { segment: DiffSegment }) {
  const isAdd = segment.kind === 'add';
  const isRemove = segment.kind === 'remove';
  const tone = isAdd
    ? 'bg-success/10 text-success'
    : isRemove
      ? 'bg-error/10 text-error'
      : 'text-muted';
  const sigil = isAdd ? '+' : isRemove ? '−' : ' ';
  return (
    <div
      className={`flex gap-2 whitespace-pre-wrap px-3 py-0.5 font-mono text-body-sm leading-5 ${tone}`}
      data-testid={`execution-compare-diff-line-${segment.kind}`}
    >
      <span aria-hidden="true" className="select-none opacity-60">
        {sigil}
      </span>
      <span>{segment.text === '' ? ' ' : segment.text}</span>
    </div>
  );
}

export function ExecutionComparisonModal({ entries, onClose }: ExecutionComparisonModalProps) {
  const { t, i18n } = useTranslation();

  // Escape closes — `OverlayBackdrop` only handles the backdrop click. We
  // attach a window listener while open and tear it down when the modal
  // unmounts (parent flips `entries` to null on close).
  useEffect(() => {
    if (!entries) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entries, onClose]);

  const diff = useComputedDiff(
    entries?.[0].snapshot?.code ?? '',
    entries?.[1].snapshot?.code ?? '',
    'line',
    entries !== null
  );

  if (!entries) return null;
  const [older, newer] = entries;
  const olderCode = older.snapshot?.code ?? '';
  const newerCode = newer.snapshot?.code ?? '';

  const summary = summarizeDiff(diff);
  const sameLanguage = older.language === newer.language;
  const truncated =
    older.snapshot?.truncated === true || newer.snapshot?.truncated === true;
  const clamped =
    olderCode.length > DIFF_MAX_INPUT_CHARS || newerCode.length > DIFF_MAX_INPUT_CHARS;

  const olderStatusLabel =
    older.status === 'ok'
      ? t('executionHistory.compare.summary.statusOk')
      : t('executionHistory.compare.summary.statusError');
  const newerStatusLabel =
    newer.status === 'ok'
      ? t('executionHistory.compare.summary.statusOk')
      : t('executionHistory.compare.summary.statusError');

  // If either side is `null` (init-failure runs), the delta and one of the
  // formatted durations collapse to `—`, which would render the awkward
  // "Duration: 10 ms → — (—)" string. Surface the durationMissing line
  // whenever any side is missing so the strip reads cleanly.
  const durationLine =
    older.durationMs === null || newer.durationMs === null
      ? t('executionHistory.compare.summary.durationMissing')
      : t('executionHistory.compare.summary.duration', {
          older: formatDuration(older.durationMs),
          newer: formatDuration(newer.durationMs),
          delta: formatDelta(older.durationMs, newer.durationMs),
        });

  const isIdentical = summary.add === 0 && summary.remove === 0;

  return (
    <OverlayBackdrop onClose={onClose}>
      <OverlayCard
        role="dialog"
        aria-modal="true"
        aria-labelledby="execution-compare-modal-title"
        className="relative w-[min(96vw,1100px)] max-w-none"
        data-testid="execution-compare-modal"
      >
        <div className="surface-header flex items-start justify-between gap-4 px-6 py-5">
          <div className="min-w-0">
            <h2
              id="execution-compare-modal-title"
              className="font-display text-h2 font-semibold leading-[1.2] tracking-[-0.02em] text-foreground"
            >
              {t('executionHistory.compare.modal.title')}
            </h2>
            <p className="mt-1 text-body-sm leading-[1.5] text-muted">
              {t('executionHistory.compare.modal.subtitle')}
            </p>
          </div>
          <IconButton
            onClick={onClose}
            tooltip={t('executionHistory.compare.modal.close')}
            data-testid="execution-compare-close"
          >
            <X size={16} />
          </IconButton>
        </div>

        <div
          data-testid="execution-compare-summary"
          className="border-b border-border/80 px-6 py-3 text-body-sm leading-[1.6] text-muted"
        >
          <div data-testid="execution-compare-summary-language">
            {sameLanguage
              ? t('executionHistory.compare.summary.languageMatch', {
                  language: older.language,
                })
              : t('executionHistory.compare.summary.languageMismatch', {
                  older: older.language,
                  newer: newer.language,
                })}
          </div>
          <div data-testid="execution-compare-summary-duration">{durationLine}</div>
          <div data-testid="execution-compare-summary-status">
            {t('executionHistory.compare.summary.status', {
              older: olderStatusLabel,
              newer: newerStatusLabel,
            })}
          </div>
          {truncated ? (
            <div
              data-testid="execution-compare-summary-truncated"
              className="mt-1 text-warning"
            >
              {t('executionHistory.compare.summary.truncated')}
            </div>
          ) : null}
          {clamped ? (
            <div
              data-testid="execution-compare-summary-clamped"
              className="mt-1 text-warning"
            >
              {t('executionHistory.compare.summary.clamped', {
                limit: DIFF_MAX_INPUT_CHARS.toLocaleString(
                  i18n.resolvedLanguage ?? i18n.language
                ),
              })}
            </div>
          ) : null}
        </div>

        <div className="grid max-h-[42vh] grid-cols-2 gap-0 overflow-hidden">
          <div className="flex flex-col border-r border-border/80">
            <div className="border-b border-border/80 px-4 py-2 text-eyebrow font-semibold uppercase tracking-[0.16em] text-muted">
              {t('executionHistory.compare.modal.olderPane')} · {older.language}
            </div>
            <pre
              data-testid="execution-compare-pane-older"
              className="m-0 flex-1 overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-body-sm leading-5 text-foreground"
            >
              {olderCode}
            </pre>
          </div>
          <div className="flex flex-col">
            <div className="border-b border-border/80 px-4 py-2 text-eyebrow font-semibold uppercase tracking-[0.16em] text-muted">
              {t('executionHistory.compare.modal.newerPane')} · {newer.language}
            </div>
            <pre
              data-testid="execution-compare-pane-newer"
              className="m-0 flex-1 overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-body-sm leading-5 text-foreground"
            >
              {newerCode}
            </pre>
          </div>
        </div>

        <div className="border-t border-border/80">
          <div className="flex items-center justify-between border-b border-border/80 px-6 py-2 text-caption uppercase tracking-[0.14em] text-muted">
            <span data-testid="execution-compare-diff-header">
              {t('executionHistory.compare.diff.header', {
                add: summary.add,
                remove: summary.remove,
              })}
            </span>
          </div>
          {isIdentical ? (
            <p
              data-testid="execution-compare-diff-identical"
              className="px-6 py-4 text-body-sm text-muted"
            >
              {t('executionHistory.compare.diff.identical')}
            </p>
          ) : (
            <div
              data-testid="execution-compare-diff-list"
              className="max-h-[28vh] overflow-y-auto px-3 py-2"
            >
              {diff.map((segment, index) => (
                <DiffLine key={index} segment={segment} />
              ))}
            </div>
          )}
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
