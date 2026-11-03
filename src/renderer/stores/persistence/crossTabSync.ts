type CrossTabMerge<S> = (stored: unknown, live: S) => S;

interface CrossTabStore<S> {
  /** Absent when storage is blocked: zustand then creates the store without it. */
  persist?: {
    getOptions: () => { name?: string; version?: number; merge?: CrossTabMerge<S> };
    setOptions: (options: { merge: CrossTabMerge<S> }) => void;
    rehydrate: () => Promise<void> | void;
  };
}

interface CrossTabOptions<S> {
  /** The persisted fields as a fresh install has them; a removed key resets to these. */
  defaults: () => Partial<S>;
  /** Fields that belong to this tab, resolved against what the other tab stored. */
  keepLocal?: (next: S, live: S) => Partial<S>;
}

/**
 * Re-read a persisted store when another tab changes it, or when this page comes
 * back from the back/forward cache, where it received no `storage` events.
 * Without this a tab's next write restores whatever another tab changed or cleared.
 * Reads storage instead of `event.newValue`, which a later write may have
 * replaced. Skips other schema versions: zustand writes back after any version
 * mismatch, so two bundles would rewrite each other forever.
 *
 * Call it right after `create()`. localStorage hydrates synchronously there, so
 * boot and migrations keep the store's own `merge`; only later rehydrates use the
 * one installed here. It never calls `setState`, which would write.
 */
export function attachCrossTabSync<S>(
  store: CrossTabStore<S>,
  { defaults, keepLocal }: CrossTabOptions<S>
): void {
  const { persist } = store;
  if (!persist || typeof window === 'undefined') return;
  const options = persist.getOptions();
  const { name, version } = options as { name: string; version: number };
  const merge = options.merge as CrossTabMerge<S>;
  persist.setOptions({
    merge: (stored, live) => {
      if (stored === undefined) return merge(undefined, { ...live, ...defaults() });
      const next = merge(stored, live);
      return keepLocal ? { ...next, ...keepLocal(next, live) } : next;
    },
  });
  const sync = () => {
    try {
      const raw = window.localStorage.getItem(name);
      if (raw === null || JSON.parse(raw)?.version === version) void persist.rehydrate();
    } catch {
      // Unreadable value: keep the live copy.
    }
  };
  window.addEventListener('storage', (event) => {
    // A null key means `localStorage.clear()`.
    if (event.key === name || event.key === null) sync();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) sync();
  });
}
