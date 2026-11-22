import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import type { LineResult } from '../../stores/resultStore';
import { replaceUnsafeText } from '../../utils/unsafeText';
import { AnswerObject } from '../Answer/AnswerObject';
import { AnswerDeltaChip, AnswerWasChip } from '../Answer/AnswerDeltaChip';
import type { AnswerDelta } from '../Answer/answerDelta';
import type { AnswerRole } from '../Answer/answerObjectModel';
import { DotLeader } from '../ui/answer';
import '../../i18n/answersCatalog';

const MAX_ITEMS_PER_LINE = 3;
/** The magic-comment keyword a pinned watch comes from; code, not copy. */
const WATCH_MARK = '@WATCH';

export interface InlineAnswerLineProps {
  readonly items: readonly LineResult[];
  readonly timing?: { readonly durationMs: number; readonly slowest: boolean };
  readonly language?: string;
  /** The line's source, read for a threshold when the line has one answer. */
  readonly source?: string;
  /** How the answer moved since run `change.since`. */
  readonly change?: { readonly delta: AnswerDelta; readonly since: number } | null;
}

function roleOf(result: LineResult): AnswerRole {
  if (result.type === 'error') return 'error';
  // A named value is a paused frame's variable, whatever channel carried it.
  if (result.name) return 'value';
  if (result.type === 'log' || result.type === 'info') return 'stdout';
  if (result.type === 'warn') return 'stderr';
  return 'value';
}

/** Unnamed answers of one kind on one line, such as a loop printing each pass. */
function isRepeat(items: readonly LineResult[]): boolean {
  if (items.length < 2) return false;
  const role = roleOf(items[0]!);
  return items.every(item => !item.name && item.type !== 'watch' && roleOf(item) === role);
}

/** Sub-100 ms keeps one decimal so quick statements do not all read as 0 ms. */
function formatTimingMs(durationMs: number): string {
  return `${durationMs >= 100 ? Math.round(durationMs).toString() : durationMs.toFixed(1)} ms`;
}

/**
 * One line's answers in the editor's answer column, after the leader from the
 * line's text. A single answer draws its picture; a line that answered the same
 * kind several times shows its latest answer and the count; mixed answers share
 * the row as values only.
 */
export function InlineAnswerLine({ items, timing, language, source, change }: InlineAnswerLineProps) {
  const { t } = useTranslation();
  const repeat = isRepeat(items);
  const visible = repeat ? items.slice(-1) : items.slice(0, MAX_ITEMS_PER_LINE);
  const dropped = repeat ? 0 : items.length - visible.length;
  const single = visible.length === 1;
  // Values read at one earlier depth share one chip at the end of the line.
  const lineDepth = visible.length > 0 && visible.every(item => item.depth === visible[0]!.depth) ? visible[0]!.depth : undefined;
  return (
    <>
      {visible.length > 0 ? <DotLeader className="lingua-inline-result-leader" /> : null}
      <span className="lingua-inline-result-body">
        {visible.some(result => result.held) ? (
          <span className="type-tag lingua-inline-result-held" title={t('answers.paused.heldHint')} data-testid="lingua-inline-result-held">
            {t('answers.paused.held')}
          </span>
        ) : null}
        {visible.map((result, index) => (
          <Fragment key={index}>
            <span
              className="lingua-inline-result-part"
              data-result-kind={result.type}
              data-depth={result.depth}
            >
              {result.type === 'watch' ? <span className="lingua-inline-result-watch">{WATCH_MARK}</span> : null}
              {result.name ? <span className="lingua-inline-result-name">{`${replaceUnsafeText(result.name)}:`}</span> : null}
              <AnswerObject
                text={String(result.value ?? '')}
                payload={result.payload}
                role={roleOf(result)}
                language={language}
                source={single ? source : undefined}
                compact={!single}
                hideTag={Boolean(result.name)}
                muted={result.depth !== undefined}
              />
              {result.previous !== undefined ? <AnswerWasChip value={result.previous} /> : null}
              {result.depth !== undefined && lineDepth === undefined ? <DepthChip label={t('answers.paused.depth', { depth: result.depth })} /> : null}
            </span>
            {index < visible.length - 1 ? <span className="lingua-inline-result-separator">·</span> : null}
          </Fragment>
        ))}
        {repeat ? (
          <span className="lingua-inline-result-repeat" data-testid="lingua-inline-result-repeat">
            {t('answers.lastOf', { count: items.length })}
          </span>
        ) : null}
        {dropped > 0 ? (
          <span className="lingua-inline-result-overflow" data-testid="lingua-inline-result-overflow">
            +{dropped}
          </span>
        ) : null}
        {lineDepth !== undefined ? <DepthChip label={t('answers.paused.depth', { depth: lineDepth })} /> : null}
        {change ? <AnswerDeltaChip delta={change.delta} since={change.since} /> : null}
        {timing ? (
          <span className="lingua-inline-result-timing" data-testid="lingua-inline-timing" data-slowest={timing.slowest ? 'true' : undefined}>
            {`▸ ${formatTimingMs(timing.durationMs)}`}
          </span>
        ) : null}
      </span>
    </>
  );
}

function DepthChip({ label }: { readonly label: string }) {
  return (
    <span className="lingua-inline-result-depth" data-testid="lingua-inline-result-depth">
      {label}
    </span>
  );
}
