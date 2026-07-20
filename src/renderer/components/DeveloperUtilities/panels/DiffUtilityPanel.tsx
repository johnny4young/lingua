import { PanelSection, StatusMessage, UtilityTextarea, UtilityToolbar } from '../panelPrimitives';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { summarizeDiff } from '../../../utils/diff';
import type { DiffGranularity, DiffSegment } from '../../../utils/diff';
import { useComputedDiff } from '../../../hooks/useComputedDiff';

export function DiffUtilityPanel() {
  const { t } = useTranslation();
  const [left, setLeft] = useState('line one\nline two\nline three');
  const [right, setRight] = useState('line one\nline two updated\nline three\nline four');
  const [granularity, setGranularity] = useState<DiffGranularity>('line');

  const segments = useComputedDiff(left, right, granularity);
  const summary = useMemo(() => summarizeDiff(segments), [segments]);

  // implementation — emit a unified-style summary line "+A −B =C" so
  // Cmd+Shift+C lands a quick clipboard-friendly snapshot instead of
  // dumping the entire diff.
  const registerOutput = useCallback(() => {
    if (segments.length === 0) return null;
    return `+${summary.add} −${summary.remove} =${summary.equal}`;
  }, [segments, summary]);
  useRegisterUtilityOutput(registerOutput);

  const runApply = useCallback(() => {
    setGranularity((prev) => prev);
  }, []);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <PanelSection
          title={t('utilities.tool.diff.leftTitle')}
          description={t('utilities.tool.diff.leftDescription')}
        >
          <UtilityTextarea
            aria-label={t('utilities.tool.diff.leftTitle')}
            value={left}
            onChange={(event) => setLeft(event.target.value)}
            spellCheck={false}
          />
        </PanelSection>
        <PanelSection
          title={t('utilities.tool.diff.rightTitle')}
          description={t('utilities.tool.diff.rightDescription')}
        >
          <UtilityTextarea
            aria-label={t('utilities.tool.diff.rightTitle')}
            value={right}
            onChange={(event) => setRight(event.target.value)}
            spellCheck={false}
          />
        </PanelSection>
      </div>
      <PanelSection
        title={t('utilities.tool.diff.resultTitle')}
        description={t('utilities.tool.diff.resultDescription')}
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-body-sm text-muted">
            <span>{t('utilities.tool.diff.granularity.label')}</span>
            <select
              aria-label={t('utilities.tool.diff.granularity.label')}
              data-testid="diff-granularity-select"
              value={granularity}
              onChange={(event) => setGranularity(event.target.value as DiffGranularity)}
              className="rounded-xl border border-border/80 bg-background/88 px-2.5 py-1.5 text-body text-foreground outline-none focus:border-primary/50"
            >
              <option value="line">{t('utilities.tool.diff.granularity.line')}</option>
              <option value="word">{t('utilities.tool.diff.granularity.word')}</option>
              <option value="character">
                {t('utilities.tool.diff.granularity.character')}
              </option>
            </select>
          </label>
          <StatusMessage
            tone="muted"
            message={t('utilities.tool.diff.summary', {
              added: summary.add,
              removed: summary.remove,
              same: summary.equal,
            })}
          />
          <UtilityToolbar
            utilityId="diff"
            primary={left}
            secondary={right}
            run={runApply}
            setPrimary={setLeft}
          />
        </div>
        {segments.length === 0 ? (
          <StatusMessage message={t('utilities.tool.diff.empty')} />
        ) : granularity === 'line' ? (
          <DiffLineResult segments={segments} />
        ) : (
          <DiffInlineResult segments={segments} />
        )}
      </PanelSection>
    </div>
  );
}

function DiffLineResult({ segments }: { segments: readonly DiffSegment[] }) {
  const rows = useMemo(() => segmentsToLineRows(segments), [segments]);
  return (
    <div
      className="max-h-[26rem] overflow-auto rounded-2xl border border-border/80 bg-background/65"
      data-testid="diff-result-line"
    >
      <ul className="grid">
        {rows.map((row, index) => {
          const prefix = row.kind === 'add' ? '+' : row.kind === 'remove' ? '-' : ' ';
          const toneClass =
            row.kind === 'add'
              ? 'bg-success/10 text-success'
              : row.kind === 'remove'
                ? 'bg-danger/10 text-danger'
                : 'text-foreground';
          return (
            <li
              key={`${row.kind}-${index}`}
              data-testid={`diff-line-${row.kind}`}
              className={`flex items-baseline gap-2 px-3 py-1 font-mono text-body-sm ${toneClass}`}
            >
              <span className="w-4 select-none text-muted">{prefix}</span>
              <span className="whitespace-pre-wrap break-words">{row.text || ' '}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DiffInlineResult({ segments }: { segments: readonly DiffSegment[] }) {
  return (
    <div
      className="max-h-[26rem] overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-border/80 bg-background/65 px-3 py-3 font-mono text-body-sm leading-5 text-foreground"
      data-testid="diff-result-inline"
    >
      {segments.map((segment, index) => {
        const toneClass =
          segment.kind === 'add'
            ? 'bg-success/15 text-success'
            : segment.kind === 'remove'
              ? 'bg-danger/15 text-danger line-through'
              : '';
        return (
          <span
            key={`${segment.kind}-${index}`}
            data-testid={`diff-segment-${segment.kind}`}
            className={toneClass}
          >
            {segment.text}
          </span>
        );
      })}
    </div>
  );
}

interface DiffLineRow {
  kind: DiffSegment['kind'];
  text: string;
}

/**
 * Line-mode segments are already bare lines (tokenizer strips trailing
 * newlines), so a row maps 1:1 to a segment. The helper keeps the call
 * site explicit about its expectations and normalizes the empty-row
 * edge case.
 */
function segmentsToLineRows(segments: readonly DiffSegment[]): DiffLineRow[] {
  return segments.map((segment) => ({ kind: segment.kind, text: segment.text }));
}
