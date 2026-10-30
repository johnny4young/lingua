import type { StatusNotice } from './uiStore';

/** One notice on screen, the rest waiting their turn. */
export interface StatusNoticeSlots {
  visible: StatusNotice | null;
  queue: StatusNotice[];
}

export interface StatusNoticeChange {
  slots: StatusNoticeSlots;
  /** Notices that will never show; their pushers get `onDismiss('auto')`. */
  dropped: StatusNotice[];
  /** The visible notice that a lower-priority push queued behind. */
  survived: StatusNotice | null;
}

const MAX_QUEUED = 5;

const rank = (notice: StatusNotice) => (notice.priority === 'high' ? 2 : notice.priority === 'low' ? 0 : 1);

/** Errors and notices that ask for a decision stay until acted on. */
export const isStickyNotice = (notice: StatusNotice): boolean => notice.tone === 'error' || notice.sticky === true;

const isUrgent = (notice: StatusNotice) => notice.tone === 'error' || notice.tone === 'warning';
const hasActions = (notice: StatusNotice) => (notice.actions?.length ?? 0) > 0;

/** Plain feedback with nothing to act on; a newer one supersedes it. */
const isTransient = (notice: StatusNotice) =>
  !isStickyNotice(notice) && !hasActions(notice) && rank(notice) < 2 && !isUrgent(notice);

const sameMessage = (a: StatusNotice, b: StatusNotice) =>
  a.messageKey === b.messageKey && JSON.stringify(a.values ?? null) === JSON.stringify(b.values ?? null);

/** Inserts by priority, oldest first within a tier, and caps the backlog. */
function insert(queue: StatusNotice[], notice: StatusNotice, atFront = false): { queue: StatusNotice[]; dropped: StatusNotice[] } {
  const next = [...queue];
  const at = atFront ? 0 : next.findIndex(entry => rank(entry) < rank(notice));
  next.splice(at < 0 ? next.length : at, 0, notice);
  const dropped: StatusNotice[] = [];
  // A decision is never dropped; past the cap the least important other notice goes.
  while (next.length > MAX_QUEUED) {
    let lowest = -1;
    for (let index = next.length - 1; index >= 0; index -= 1) {
      if (!isStickyNotice(next[index]!) && (lowest < 0 || rank(next[index]!) < rank(next[lowest]!))) lowest = index;
    }
    if (lowest < 0) break;
    dropped.push(...next.splice(lowest, 1));
  }
  return { queue: next, dropped };
}

export function pushToSlots({ visible, queue }: StatusNoticeSlots, incoming: StatusNotice): StatusNoticeChange {
  if (!visible) return { slots: { visible: incoming, queue }, dropped: [], survived: null };
  // A repeat of what is on screen or waiting refreshes it in place.
  if (sameMessage(visible, incoming)) return { slots: { visible: incoming, queue }, dropped: [visible], survived: null };
  const waiting = queue.findIndex(entry => sameMessage(entry, incoming));
  if (waiting >= 0) {
    return { slots: { visible, queue: queue.map((entry, index) => (index === waiting ? incoming : entry)) }, dropped: [queue[waiting]!], survived: null };
  }
  // The latest thing the user did answers first; only a decision on screen makes it wait.
  if (isUrgent(incoming) || (!isStickyNotice(visible) && rank(incoming) >= rank(visible))) {
    // The notice on screen gives way; one that still offers an action comes back after.
    if (!isStickyNotice(visible) && !hasActions(visible)) {
      return { slots: { visible: incoming, queue }, dropped: [visible], survived: null };
    }
    const requeued = insert(queue, visible, true);
    return { slots: { visible: incoming, queue: requeued.queue }, dropped: requeued.dropped, survived: null };
  }
  // Only the newest plain notice is worth showing once the screen frees up.
  const base = isTransient(incoming) ? queue.filter(entry => !isTransient(entry)) : queue;
  const superseded = isTransient(incoming) ? queue.filter(isTransient) : [];
  const inserted = insert(base, incoming);
  return {
    slots: { visible, queue: inserted.queue },
    dropped: [...superseded, ...inserted.dropped],
    survived: rank(incoming) < rank(visible) ? visible : null,
  };
}

/** The next notice to show once the visible one goes away. */
export function advanceSlots({ queue }: StatusNoticeSlots): StatusNoticeSlots {
  const [next, ...rest] = queue;
  return { visible: next ?? null, queue: rest };
}
