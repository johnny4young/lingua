import { useAutoRunGateCopy } from './dockNotices';

/**
 * Ambient footer notice for the auto-run completion
 * gate.
 *
 * Renders inside the results dock header (next to the execution-time
 * pill) when `autoRunGateReason === 'incomplete'`. One line,
 * `text-caption text-muted`, no icon, no toast — intentionally quiet
 * so it doesn't fight the user's editing flow.
 *
 * When the active tab is in `runtimeMode === 'browser-
 * preview'`, the copy swaps to the "Preview paused" variant so a DOM-
 * oriented user knows that what is paused is the iframe re-render,
 * not the console refresh.
 */
export function AutoRunGateNotice() {
  const gate = useAutoRunGateCopy();
  if (!gate) return null;

  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="auto-run-gate-notice"
      data-gate-variant={gate.variant}
      className="status-pill border-warning/30 bg-warning/10 px-2 py-0.5 text-eyebrow font-medium tracking-[0.02em] text-warning"
      title={gate.description}
    >
      {gate.title}
    </span>
  );
}
