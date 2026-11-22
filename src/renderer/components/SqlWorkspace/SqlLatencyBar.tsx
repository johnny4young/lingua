import { cn } from '../../utils/cn';
import { latencyShare } from '../../utils/latencyScale';

/** A run's time as a bar against the slowest run beside it; the duration text sits next to it. */
export function SqlLatencyBar({
  durationMs,
  maxMs,
  failed = false,
  className = 'flex w-10',
}: {
  durationMs: number;
  maxMs: number;
  failed?: boolean;
  /** Display and track width. */
  className?: string;
}) {
  const share = latencyShare(durationMs, maxMs);
  return (
    <span aria-hidden="true" data-testid="sql-latency-bar" className={cn('h-1 shrink-0 items-center', className)}>
      <span
        className={cn('h-full rounded-full', failed ? 'bg-error-fg' : 'bg-fg-muted')}
        style={{ width: `max(0.25rem, ${(share * 100).toFixed(1)}%)` }}
      />
    </span>
  );
}
