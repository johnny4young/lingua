export type DependencyDetectionRuntimeModule = typeof import('./dependencyDetectionRuntime');

export type DependencyDetectionRuntimeImport = () => Promise<DependencyDetectionRuntimeModule>;

export interface DependencyDetectionRuntimeLoader {
  readonly load: () => Promise<DependencyDetectionRuntimeModule>;
}

/**
 * Build a session cache around a dynamic runtime import. Keeping the import
 * injectable makes the concurrency and rejected-request retry contract a real
 * test gate rather than an assumption about the bundler.
 */
export function createDependencyDetectionRuntimeLoader(
  importRuntime: DependencyDetectionRuntimeImport
): DependencyDetectionRuntimeLoader {
  let runtimePromise: Promise<DependencyDetectionRuntimeModule> | null = null;

  return {
    load: () => {
      if (runtimePromise) return runtimePromise;
      const pending = importRuntime();
      const guarded = pending.catch((error: unknown) => {
        if (runtimePromise === guarded) runtimePromise = null;
        throw error;
      });
      runtimePromise = guarded;
      return guarded;
    },
  };
}

const runtimeLoader = createDependencyDetectionRuntimeLoader(
  () => import('./dependencyDetectionRuntime')
);

/** Load one shared runtime instance and evict rejected requests for retry. */
export function loadDependencyDetectionRuntime(): Promise<DependencyDetectionRuntimeModule> {
  return runtimeLoader.load();
}
