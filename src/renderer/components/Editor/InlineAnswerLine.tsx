import { Fragment } from 'react';
import type { LineResult } from '../../stores/resultStore';
import { replaceUnsafeText } from '../../utils/unsafeText';
import { AnswerObject } from '../Answer/AnswerObject';
import type { AnswerRole } from '../Answer/answerObjectModel';
import { DotLeader } from '../ui/answer';

const MAX_ITEMS_PER_LINE = 3;
/** The magic-comment keyword a pinned watch comes from; code, not copy. */
const WATCH_MARK = '@WATCH';

export interface InlineAnswerLineProps {
  readonly items: readonly LineResult[];
  readonly timing?: { readonly durationMs: number; readonly slowest: boolean };
  readonly language?: string;
  /** The line's source, read for a threshold when the line has one answer. */
  readonly source?: string;
}

function roleOf(result: LineResult): AnswerRole {
  if (result.type === 'error') return 'error';
  // A named value is a paused frame's variable, whatever channel carried it.
  if (result.name) return 'value';
  if (result.type === 'log' || result.type === 'info') return 'stdout';
  if (result.type === 'warn') return 'stderr';
  return 'value';
}

/** Sub-100 ms keeps one decimal so quick statements do not all read as 0 ms. */
function formatTimingMs(durationMs: number): string {
  return `${durationMs >= 100 ? Math.round(durationMs).toString() : durationMs.toFixed(1)} ms`;
}

/**
 * One line's answers in the editor's answer column, after the leader from the
 * line's text. A single answer draws its picture; several on one line share the
 * row as values only.
 */
export function InlineAnswerLine({ items, timing, language, source }: InlineAnswerLineProps) {
  const visible = items.slice(0, MAX_ITEMS_PER_LINE);
  const dropped = items.length - visible.length;
  const single = visible.length === 1;
  return (
    <>
      {visible.length > 0 ? <DotLeader className="lingua-inline-result-leader" /> : null}
      <span className="lingua-inline-result-body">
        {visible.map((result, index) => (
          <Fragment key={index}>
            <span className="lingua-inline-result-part" data-result-kind={result.type}>
              {result.type === 'watch' ? <span className="lingua-inline-result-watch">{WATCH_MARK}</span> : null}
              {result.name ? <span className="lingua-inline-result-name">{`${replaceUnsafeText(result.name)}:`}</span> : null}
              <AnswerObject
                text={String(result.value ?? '')}
                payload={result.payload}
                role={roleOf(result)}
                language={language}
                source={single ? source : undefined}
                compact={!single}
              />
            </span>
            {index < visible.length - 1 ? <span className="lingua-inline-result-separator">·</span> : null}
          </Fragment>
        ))}
        {dropped > 0 ? (
          <span className="lingua-inline-result-overflow" data-testid="lingua-inline-result-overflow">
            +{dropped}
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
