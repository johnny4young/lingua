import type * as ProjectBundleRuntime from './projectBundleRuntime';

let runtimePromise: Promise<typeof ProjectBundleRuntime> | null = null;

/**
 * Cache a successful project bundle implementation load for the session.
 * Rejected chunk requests are evicted so a later explicit action can retry.
 */
export function loadProjectBundleRuntime(): Promise<typeof ProjectBundleRuntime> {
  runtimePromise ??= import('./projectBundleRuntime');
  return runtimePromise.catch((error: unknown) => {
    runtimePromise = null;
    throw error;
  });
}
