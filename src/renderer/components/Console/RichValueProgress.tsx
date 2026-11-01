import type { RichOutputProgress } from '../../../shared/richOutput';
import { progressPercent } from '../../../shared/richDisplay';

/** `lingua.display.progress()`: one bar, redrawn in place as the run updates it. */
export function RichValueProgress({ payload }: { payload: RichOutputProgress }) {
  const percent = progressPercent(payload.value);
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2 font-mono text-caption" data-testid="rich-value-progress">
      {payload.label ? <span className="shrink-0 text-fg-muted">{payload.label}</span> : null}
      <span
        role="progressbar"
        aria-label={payload.label || undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="relative h-2 w-40 shrink-0 overflow-hidden rounded bg-border-subtle"
      >
        <span className="absolute inset-y-0 left-0 rounded bg-accent" style={{ width: `${percent}%` }} />
      </span>
      <span className="shrink-0 text-fg-base">{percent}%</span>
      {payload.text ? <span className="min-w-0 truncate text-fg-muted">{payload.text}</span> : null}
    </span>
  );
}
