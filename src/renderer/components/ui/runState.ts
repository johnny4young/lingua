/** Line states drawn on the run rail. */
export const RUN_STATES = ['not-run', 'running', 'answered', 'raised', 'paused', 'stale'] as const;
export type RunState = (typeof RUN_STATES)[number];

/** A tab's last-run dot. */
export const TAB_RUN_STATES = ['ok', 'error', 'stale', 'running'] as const;
export type TabRunState = (typeof TAB_RUN_STATES)[number];
