import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import './identity.css';

export type AnswerTone = 'neutral' | 'error';

/** Small-caps type label (FLOAT, LIST·7, STDOUT). Labels only, never values. */
export function TypeTag({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={cn('type-tag', className)} title={title}>
      {children}
    </span>
  );
}

export interface ResultNumeralProps {
  value: ReactNode;
  unit?: ReactNode;
  /** Words a locale puts before the number ("in", "hace"), set like the unit. */
  lead?: ReactNode;
  /** 19 / 26 / 44 / 88 px numerals. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Counts stay neutral; `error` is reserved for a failed answer. */
  tone?: AnswerTone;
  /** A word in the numeral slot (an error name) sets smaller than digits. */
  word?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** A Fraunces result numeral with its unit in italic. */
export function ResultNumeral({
  value,
  unit,
  lead,
  size = 'md',
  tone = 'neutral',
  word = false,
  className,
  'data-testid': testId,
}: ResultNumeralProps) {
  return (
    <span className={cn('result-numeral', className)} data-size={size} data-tone={tone} data-word={word ? '' : undefined} data-testid={testId}>
      {lead ? <span className="result-numeral-unit">{lead}</span> : null}
      <span className="result-numeral-value">{value}</span>
      {unit ? <span className="result-numeral-unit">{unit}</span> : null}
    </span>
  );
}

/** The dotted leader that joins a line to its answer. */
export function DotLeader({ tone = 'neutral', className }: { tone?: AnswerTone; className?: string }) {
  return <span aria-hidden className={cn('dot-leader leader-fill', className)} data-tone={tone} />;
}

export interface LeaderRowProps {
  label: ReactNode;
  value: ReactNode;
  tone?: AnswerTone;
  /** Play the answer motion (leader draws, value fades up); set it only on a newly arrived answer. */
  enter?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** Label, dot leader, value: the table-of-contents row every answer uses. */
export function LeaderRow({
  label,
  value,
  tone = 'neutral',
  enter = false,
  className,
  'data-testid': testId,
}: LeaderRowProps) {
  return (
    <div className={cn('leader-row', className)} data-enter={enter ? '' : undefined} data-testid={testId}>
      <span className="leader-row-label">{label}</span>
      <DotLeader tone={tone} />
      <span className="leader-row-value">{value}</span>
    </div>
  );
}
