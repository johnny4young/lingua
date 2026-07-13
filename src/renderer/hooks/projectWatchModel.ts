import type { WatchChange } from '../stores/projectStore';

export const PROJECT_WATCH_REFRESH_DEBOUNCE_MS = 150;

export interface WatchChangeBatch {
  rootId: string | null;
  changes: Map<string, WatchChange>;
}

export function createWatchChangeBatch(): WatchChangeBatch {
  return { rootId: null, changes: new Map() };
}

/** Coalesce same-path events while preserving structural rename precedence. */
export function queueWatchChange(batch: WatchChangeBatch, event: FsChangedEvent): void {
  if (batch.rootId !== event.rootId) {
    batch.changes.clear();
    batch.rootId = event.rootId;
  }

  const existing = batch.changes.get(event.relativePath);
  const next: WatchChange = {
    relativePath: event.relativePath,
    eventType: event.eventType,
    filename: event.filename,
  };
  if (!existing || existing.eventType === 'change' || event.eventType !== 'change') {
    batch.changes.set(event.relativePath, next);
  }
}

/** Drain the active root's batch, or discard it after a project switch. */
export function takeWatchChanges(
  batch: WatchChangeBatch,
  activeRootId: string | null
): WatchChange[] | null {
  if (!activeRootId || batch.rootId !== activeRootId) {
    clearWatchChangeBatch(batch);
    return null;
  }
  const changes = Array.from(batch.changes.values());
  clearWatchChangeBatch(batch);
  return changes;
}

export function clearWatchChangeBatch(batch: WatchChangeBatch): void {
  batch.changes.clear();
  batch.rootId = null;
}
