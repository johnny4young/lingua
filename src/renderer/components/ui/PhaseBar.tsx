import type { AriaAttributes } from 'react';
import { cn } from '../../utils/cn';

export interface PhaseBarSegment {
  key: string;
  ms: number;
  /** A theme variable, set inline so no class reaches the boot stylesheet. */
  color: string;
}

/** Timed phases as one proportional bar; a phase that took no time draws nothing. */
export function PhaseBar({
  segments,
  className,
  ...aria
}: { segments: ReadonlyArray<PhaseBarSegment>; className?: string; role?: 'img' } & AriaAttributes) {
  return (
    <span {...aria} className={cn('flex gap-0.5 overflow-hidden rounded-full bg-bg-inset', className)}>
      {segments.map((segment) =>
        segment.ms > 0 ? (
          <span key={segment.key} data-phase={segment.key} style={{ flexGrow: segment.ms, minWidth: 2, background: segment.color }} />
        ) : null
      )}
    </span>
  );
}
