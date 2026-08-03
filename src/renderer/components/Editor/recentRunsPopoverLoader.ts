import type { ComponentType } from 'react';
import type { ExecutionHistoryEntry } from '../../stores/executionHistoryStore';

export interface RecentRunsPopoverProps {
  readonly entries: readonly ExecutionHistoryEntry[];
  readonly onClose: () => void;
}

interface RecentRunsPopoverModule {
  RecentRunsPopover: ComponentType<RecentRunsPopoverProps>;
}

let popoverPromise: Promise<RecentRunsPopoverModule> | null = null;

/**
 * Share one Recent Runs popover implementation across activations.
 *
 * Failed module fetches remain cached for the current document because
 * browsers retain failed module URLs. The host offers a page reload instead
 * of presenting a retry that cannot reliably recover.
 */
export function loadRecentRunsPopover(): Promise<RecentRunsPopoverModule> {
  popoverPromise ??= import('./RecentRunsPopover');
  return popoverPromise;
}
