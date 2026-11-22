import { cn } from '../../utils/cn';
import { glyphA11y } from './glyphSet';
import type { RunState, TabRunState } from './runState';
import './identity.css';

const DASH = { stroke: 'var(--rs-rule)', strokeWidth: 2, strokeDasharray: '2 4' } as const;
const LIT = { stroke: 'var(--rs-pulse)', strokeWidth: 2 } as const;

function RailMarks({ state }: { state: RunState }) {
  switch (state) {
    case 'not-run':
      return <path d="M11 0v30" {...DASH} />;
    case 'running':
      return (
        <>
          <path d="M11 0v15" {...LIT} />
          <path d="M11 15v15" {...DASH} />
          <circle cx="11" cy="15" r="8" fill="var(--rs-pulse)" opacity=".18" />
          <circle cx="11" cy="15" r="4" fill="var(--rs-pulse)" />
        </>
      );
    case 'answered':
      return (
        <>
          <path d="M11 0v30" {...LIT} />
          <rect x="8" y="13" width="6" height="4" rx="2" fill="var(--rs-pulse)" />
        </>
      );
    case 'raised':
      return (
        <>
          <path d="M11 0v15" {...LIT} />
          <path d="m7 11 8 8M15 11l-8 8" stroke="var(--rs-error)" strokeWidth={2} strokeLinecap="round" />
        </>
      );
    case 'paused':
      return (
        <>
          <path d="M11 0v9" {...LIT} />
          <path d="M11 21v9" {...DASH} />
          <rect x="5" y="9" width="12" height="12" rx="6" fill="none" stroke="var(--rs-hold)" strokeWidth={1.6} />
          <path d="M9.3 12.5v5M12.7 12.5v5" stroke="var(--rs-hold)" strokeWidth={1.6} strokeLinecap="round" />
        </>
      );
    case 'stale':
      return (
        <>
          <path d="M11 0v30" stroke="var(--rs-stale-line)" strokeWidth={2} />
          <rect x="8" y="13" width="6" height="4" rx="2" fill="none" stroke="var(--rs-stale-mark)" strokeWidth={1.2} />
        </>
      );
  }
}

export interface RunStateGlyphProps {
  state: RunState;
  /** Accessible name. Without it the glyph is decorative and hidden. */
  label?: string;
  className?: string;
}

/** One line of the run rail: where the pulse is and what the line did. */
export function RunStateGlyph({ state, label, className }: RunStateGlyphProps) {
  return (
    <svg
      {...glyphA11y(label)}
      data-run-state={state}
      className={cn('run-state-glyph', className)}
      width="22"
      height="30"
      viewBox="0 0 22 30"
      fill="none"
    >
      <RailMarks state={state} />
    </svg>
  );
}

/** A tab's last-run dot. */
export function RunDot({ state, label }: { state: TabRunState; label?: string }) {
  return <span {...glyphA11y(label)} data-run-dot={state} className="run-dot" />;
}
