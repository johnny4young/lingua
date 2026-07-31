interface DisposableAdapter {
  dispose: () => void;
}

export interface ActivationScopedAdapterLoader<TAdapter extends DisposableAdapter> {
  get: () => TAdapter | null;
  load: () => Promise<TAdapter | null>;
  setForTesting: (adapter: TAdapter | null) => void;
}

/**
 * Own one retryable implementation load while keeping synchronous hot-path
 * access after activation. The generation prevents a late import from
 * overwriting an adapter installed or cleared by a test/reset boundary.
 */
export function createActivationScopedAdapterLoader<TAdapter extends DisposableAdapter>(
  createAdapter: () => Promise<TAdapter | null>
): ActivationScopedAdapterLoader<TAdapter> {
  let singleton: TAdapter | null = null;
  let loadPromise: Promise<TAdapter | null> | null = null;
  let generation = 0;

  return {
    get: () => singleton,
    load: () => {
      if (singleton) return Promise.resolve(singleton);
      if (loadPromise) return loadPromise;

      const requestedGeneration = generation;
      const pending = Promise.resolve()
        .then(createAdapter)
        .then(adapter => {
          if (!adapter) return null;
          if (requestedGeneration !== generation || singleton) {
            adapter.dispose();
            return singleton;
          }
          singleton = adapter;
          return singleton;
        })
        .finally(() => {
          if (loadPromise === pending) loadPromise = null;
        });
      loadPromise = pending;
      return pending;
    },
    setForTesting: adapter => {
      generation += 1;
      loadPromise = null;
      if (singleton && adapter !== singleton) {
        singleton.dispose();
      }
      singleton = adapter;
    },
  };
}
