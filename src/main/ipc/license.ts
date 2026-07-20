/**
 * License IPC handlers .
 *
 * Bridges `window.lingua.license.*` calls in the renderer to the main-side
 * runtime created in `src/main/license.ts`. The renderer never imports
 * `node:crypto` or touches the user-data directory directly — every state
 * mutation lands on this module first.
 */

import type { LicenseRuntime } from '../license';
import type { RemoveDeviceResult } from '../licenseServer';
import { typedHandle } from './typedHandle';

// internal / typed IPC contract: the `license:*` handlers bind to
// `typedHandle`, so `tsc` checks each handler's return type against the
// contract result. This became possible once the ambient
// `LicensePayloadShape.tier` in `src/types.d.ts` was widened to the full
// canonical 6-tier list (matching `src/shared/license.ts`), so main's
// snapshot type is assignable to the contract's ambient shape.
export function registerLicenseHandlers(
  runtimeSource: LicenseRuntime | PromiseLike<LicenseRuntime>
): void {
  // internal — register the channels before the window loads, while allowing
  // main to construct the runtime in parallel with the renderer's first
  // paint. Every channel shares the same promise, so concurrent bootstrap
  // calls wait for one runtime instead of starting duplicate verification.
  const runtimeReady = Promise.resolve(runtimeSource);
  // Attach a rejection observer immediately. The individual handlers still
  // receive the rejection and map it through their existing failure paths,
  // but a slow renderer must not leave an early runtime failure unhandled.
  void runtimeReady.catch((error: unknown) => {
    console.error(
      '[lingua] license runtime failed to initialize:',
      error instanceof Error ? error.message : String(error)
    );
  });

  typedHandle('license:get-state', async () => {
    const runtime = await runtimeReady;
    return runtime.getSnapshot();
  });

  typedHandle('license:apply-token', async (_event, token: unknown): Promise<LicenseApplyResult> => {
    if (typeof token !== 'string') {
      return { ok: false, reason: 'invalid-input', message: 'Expected a string token.' };
    }
    try {
      const runtime = await runtimeReady;
      const status = await runtime.applyToken(token);
      return { ok: true, data: { status, snapshot: runtime.getSnapshot() } };
    } catch (error) {
      return {
        ok: false,
        reason: 'apply-failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });

  typedHandle('license:clear', async (): Promise<LicenseClearResult> => {
    try {
      const runtime = await runtimeReady;
      await runtime.clear();
      return { ok: true, data: { snapshot: runtime.getSnapshot() } };
    } catch (error) {
      return {
        ok: false,
        reason: 'clear-failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });

  typedHandle('license:revalidate', async (): Promise<LicenseApplyResult> => {
    try {
      const runtime = await runtimeReady;
      const status = await runtime.revalidate();
      return { ok: true, data: { status, snapshot: runtime.getSnapshot() } };
    } catch (error) {
      return {
        ok: false,
        reason: 'revalidate-failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // implementation — desktop's parallel of `/licenses/devices/remove`.
  // Renderer's `licenseStore` desktop branch delegates here through
  // `window.lingua.license.removeDevice(deviceIdToRemove)`. The
  // wrapper-side tagged union (`RemoveDeviceResult`) is normalized to
  // the shared IPC Result contract with a snapshot in the success data
  // so callers do not have to refetch state.
  typedHandle(
    'license:remove-device',
    async (_event, deviceIdToRemove: unknown): Promise<LicenseRemoveDeviceResult> => {
      if (typeof deviceIdToRemove !== 'string' || deviceIdToRemove.length === 0) {
        return { ok: false, reason: 'invalid-input', message: 'Expected a non-empty deviceId.' };
      }
      try {
        const runtime = await runtimeReady;
        const result: RemoveDeviceResult = await runtime.removeDevice(deviceIdToRemove);
        if (result.ok) {
          return {
            ok: true,
            data: { removed: result.removed, snapshot: runtime.getSnapshot() },
          };
        }
        return {
          ok: false,
          reason: result.reason,
          message: result.message,
          issues: result.issues,
        };
      } catch (error) {
        return {
          ok: false,
          reason: 'remove-failed',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );
}
