/**
 * accessibility pass — convenience hook returning the shared `announce` action.
 *
 * The action is stable (a zustand setter), so this never re-renders the
 * caller. Use it inside components; in pure event handlers you can also
 * call the imperative `announce(...)` from the store module directly.
 */
import { useAnnouncerStore } from '../stores/announcerStore';

export function useAnnounce(): (message: string) => void {
  return useAnnouncerStore((state) => state.announce);
}
