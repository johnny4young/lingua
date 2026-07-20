/**
 * accessibility pass — shared screen-reader announcer.
 *
 * A single polite live region (rendered once by {@link LiveAnnouncer})
 * that any surface can push a transient message into for assistive tech:
 * "Ran 3 steps", "12 results", "Query returned 40 rows", etc.
 *
 * This is the internal sibling of the visible `StatusNoticeBanner` toast.
 * Use it for dynamic state changes that a sighted user perceives visually
 * (a result count updating, a run finishing) but that are otherwise
 * silent to a screen-reader user. It is NOT a replacement for the toast
 * — error/CTA notices still go through `pushStatusNotice` (which renders
 * its own `role=alert`/`role=status`).
 *
 * `nonce` increments on every announce so {@link LiveAnnouncer} can force
 * the live region's text node to change even when the same message is
 * announced twice in a row (screen readers only announce on change).
 */
import { create } from 'zustand';

interface AnnouncerState {
  /** The latest message to announce (empty string = nothing yet). */
  message: string;
  /** Bumped on every announce so identical repeats still re-announce. */
  nonce: number;
  /** Push a polite announcement to the shared live region. */
  announce: (message: string) => void;
}

export const useAnnouncerStore = create<AnnouncerState>((set) => ({
  message: '',
  nonce: 0,
  announce: (message) => set((state) => ({ message, nonce: state.nonce + 1 })),
}));

/**
 * Imperative announce for event handlers that should not subscribe to the
 * store. Equivalent to `useAnnouncerStore.getState().announce(message)`.
 */
export function announce(message: string): void {
  useAnnouncerStore.getState().announce(message);
}
