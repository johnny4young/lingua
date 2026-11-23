import { cn } from '../../utils/cn';
import { DotLeader, TypeTag } from './answer';

export interface InlineMarkerProps {
  /** The evaluated value, e.g. "50". */
  value: string;
  /** The runtime type tag, e.g. "number". */
  type: string;
  /** When set, adds the @WATCH marker before the type. */
  watch?: boolean;
  className?: string;
}

const WATCH_MARK = '@WATCH';

const TONE_BY_TYPE = new Map(Object.entries({
  number: 'number',
  int: 'number',
  float: 'number',
  bigint: 'number',
  string: 'string',
  str: 'string',
  boolean: 'boolean',
  bool: 'boolean',
  date: 'date',
  datetime: 'date',
  error: 'error',
  null: 'none',
  undefined: 'none',
  none: 'none',
  nonetype: 'none',
}));

/** Dot leader, type, then the value in its type colour: the answer grammar on one line. */
export function InlineMarker({ value, type, watch = false, className }: InlineMarkerProps) {
  // Exception classes (KeyError, TypeError) read as errors too.
  const tone = TONE_BY_TYPE.get(type.toLowerCase()) ?? (/(?:error|exception)$/i.test(type) ? 'error' : undefined);
  return (
    <span data-testid="inline-marker" className={cn('flex flex-1 items-center font-mono', className)}>
      <DotLeader tone={tone === 'error' ? 'error' : 'neutral'} />
      <span className="leader-row-value">
        {watch ? <span className="lingua-inline-result-watch">{WATCH_MARK}</span> : null}
        <TypeTag>{type}</TypeTag>
        <span data-testid="inline-marker-value" className="value-tone" data-tone={tone}>
          {value}
        </span>
      </span>
    </span>
  );
}
