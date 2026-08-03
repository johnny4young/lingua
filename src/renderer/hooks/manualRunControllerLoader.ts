import type * as ManualRunController from '../runtime/manualRunController';

let controllerPromise: Promise<typeof ManualRunController> | null = null;

/**
 * Load the manual-run implementation on the first explicit run request.
 *
 * Persistent toolbar controls only need reactive status from `resultStore`;
 * entitlement checks, native trust gating, announcements, and execution
 * orchestration stay outside the startup graph. Rejected chunk requests are
 * evicted so a later Run action can retry.
 */
export function loadManualRunController(): Promise<typeof ManualRunController> {
  controllerPromise ??= import('../runtime/manualRunController');
  return controllerPromise.catch((error: unknown) => {
    controllerPromise = null;
    throw error;
  });
}
