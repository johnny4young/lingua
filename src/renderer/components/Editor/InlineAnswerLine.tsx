import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import type { LineResult } from '../../stores/resultStore';
import { replaceUnsafeText } from '../../utils/unsafeText';
import { AnswerObject } from '../Answer/AnswerObject';
import { AnswerDeltaChip, AnswerWasChip } from '../Answer/AnswerDeltaChip';
import type { AnswerDelta } from '../Answer/answerDelta';
import type { AnswerRole } from '../Answer/answerObjectModel';
import { DotLeader, TypeTag } from '../ui/answer';
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
  /** The run this answer is kept from, while the current run has not reached the line. */
  readonly keptFrom?: number;
  /** Passes the open loop around this line makes, while the run is live and the runtime knows it. */
  readonly loopTotal?: number;
}

function roleOf(result: LineResult): AnswerRole {
  if (result.type === 'error') return 'error';
  // A named value is a paused frame's variable, whatever channel carried it.
  if (result.name) return 'value';
  if (result.type === 'log' || result.type === 'info') return 'stdout';
  if (result.type === 'warn') return 'stderr';
  return 'value';
}

/**
 * A line that answered on loop passes: the latest pass's answers and how many passes, one included.
 * With pass numbers, answers of one pass are separate calls; without them, unnamed answers of one kind count as passes.
 */
function readRepeat(items: readonly LineResult[]): { readonly latest: readonly LineResult[]; readonly passes: number } | null {
  if (items.length === 0 || items.some(item => item.name || item.type === 'watch')) return null;
  if (items.every(item => item.pass !== undefined)) {
    const last = items[items.length - 1]!.pass;
    return { latest: items.filter(item => item.pass === last), passes: new Set(items.map(item => item.pass)).size };
  }
  const role = roleOf(items[0]!);
  return items.length > 1 && items.every(item => roleOf(item) === role) ? { latest: items.slice(-1), passes: items.length } : null;
}

function isOutput(result: LineResult): boolean {
  const role = roleOf(result);
  return role === 'stdout' || role === 'stderr';
}

/** Output after output of the same kind on one line keeps the line's single kind tag. */
function repeatsKind(items: readonly LineResult[], index: number): boolean {
  if (index === 0) return false;
  const role = roleOf(items[index]!);
  return role !== 'value' && role === roleOf(items[index - 1]!);
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
export function InlineAnswerLine({ items, timing, language, source, change, keptFrom, loopTotal }: InlineAnswerLineProps) {
  const { t } = useTranslation();
  const read = readRepeat(items);
  // Inside a live loop, a line that answered on one pass so far counts it too.
  const repeat = read && (read.passes > 1 || loopTotal !== undefined) ? read : null;
  const shown = repeat ? repeat.latest : items;
  const visible = shown.slice(0, MAX_ITEMS_PER_LINE);
  const dropped = shown.length - visible.length;
  const single = visible.length === 1;
  // Values read at one earlier depth share one chip at the end of the line; a calling frame tags its own depth.
  const lineDepth =
    visible.length > 0 && !visible.some(item => item.frameCall) && visible.every(item => item.depth === visible[0]!.depth)
      ? visible[0]!.depth
      : undefined;
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
            {result.frameCall ? (
              <FrameCallAnswer frameCall={result.frameCall} value={result.value} depth={result.depth} />
            ) : (
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
                hideTag={Boolean(result.name) || repeatsKind(visible, index)}
                muted={result.depth !== undefined}
              />
              {result.previous !== undefined ? <AnswerWasChip value={result.previous} /> : null}
              {result.depth !== undefined && lineDepth === undefined ? <DepthChip label={t('answers.paused.depth', { depth: result.depth })} /> : null}
            </span>
            )}
            {index < visible.length - 1 ? <span className="lingua-inline-result-separator">·</span> : null}
          </Fragment>
        ))}
        {repeat ? (
          <span className="lingua-inline-result-repeat" data-testid="lingua-inline-result-repeat">
            {loopTotal !== undefined && repeat.passes <= loopTotal
              ? t(isOutput(shown[0]!) ? 'answers.passPrinted' : 'answers.pass', { iteration: repeat.passes, total: loopTotal })
              : t('answers.lastOf', { count: repeat.passes })}
          </span>
        ) : null}
        {dropped > 0 ? (
          <span className="lingua-inline-result-overflow" data-testid="lingua-inline-result-overflow">
            +{dropped}
          </span>
        ) : null}
        {lineDepth !== undefined ? <DepthChip label={t('answers.paused.depth', { depth: lineDepth })} /> : null}
        {change ? <AnswerDeltaChip delta={change.delta} since={change.since} /> : null}
        {keptFrom !== undefined ? (
          <span className="answer-delta lingua-inline-result-kept" data-testid="lingua-inline-result-kept">
            {t('answers.kept', { number: keptFrom })}
          </span>
        ) : null}
        {timing ? (
          <span className="lingua-inline-result-timing" data-testid="lingua-inline-timing" data-slowest={timing.slowest ? 'true' : undefined}>
            {`▸ ${formatTimingMs(timing.durationMs)}`}
          </span>
        ) : null}
      </span>
    </>
  );
}

/** A calling frame's line: the call it waits on, or the top level's chain of calls that have not returned. */
function FrameCallAnswer({
  frameCall,
  value,
  depth,
}: {
  readonly frameCall: NonNullable<LineResult['frameCall']>;
  readonly value: string;
  readonly depth?: number;
}) {
  const { t } = useTranslation();
  const text = replaceUnsafeText(value);
  if (frameCall.kind === 'calling') {
    return (
      <span className="lingua-inline-result-part lingua-inline-result-frame" data-frame-call="calling" data-testid="lingua-inline-result-frame">
        <TypeTag className="lingua-inline-result-frame-tag">{t('answers.frame.calling')}</TypeTag>
        <span className="lingua-inline-result-frame-chain">{text}</span>
        <DepthChip label={t('answers.frame.notReturned', { depth: frameCall.depth })} />
      </span>
    );
  }
  return (
    <span className="lingua-inline-result-part lingua-inline-result-frame" data-frame-call="waiting" data-depth={depth} data-testid="lingua-inline-result-frame">
      {depth !== undefined ? <TypeTag className="lingua-inline-result-frame-tag">{t('answers.paused.depth', { depth })}</TypeTag> : null}
      <span>{t('answers.frame.waiting', { call: text })}</span>
      {frameCall.thisCall ? <span className="lingua-inline-result-this-call">{`↰ ${t('answers.frame.thisCall')}`}</span> : null}
    </span>
  );
}

function DepthChip({ label }: { readonly label: string }) {
  return (
    <span className="lingua-inline-result-depth" data-testid="lingua-inline-result-depth">
      {label}
    </span>
  );
}
