/**
 * License IPC handlers .
 *
 * Bridges `window.lingua.license.*` calls in the renderer to the main-side
 * runtime created in `src/main/license.ts`. The renderer never imports
 * `node:crypto` or touches the user-data directory directly — every state
 * mutation lands on this module first.
 */

import type { LicenseRuntime } from '../license';
import type {
  EducationRenewResult,
  EducationStartResult,
  LicenseRecoverResult,
  TrialStartResult,
} from '../../shared/licenseServerTypes';
import {
  renewEducation,
  startEducation,
  startRecovery,
  startTrial,
  type RemoveDeviceResult,
} from '../licenseServer';
import { typedHandle } from './typedHandle';

const TEXT_ENCODER = new TextEncoder();

// Same byte caps as the Worker's validator (license-server/src/lib/validation.ts).
const FLOW_FIELD_BYTE_CAPS = {
  email: 254,
  deviceId: 128,
  deviceName: 254,
  os: 64,
  token: 4096,
} as const;

type FlowField = keyof typeof FLOW_FIELD_BYTE_CAPS;

interface FlowInputFailure {
  ok: false;
  reason: 'invalid-input';
  message: string;
  issues: string[];
}

const TRIAL_FIELDS = ['email', 'deviceId', 'deviceName', 'os'] as const;
const EDUCATION_START_FIELDS = ['email', 'deviceId', 'deviceName', 'os'] as const;
const EDUCATION_RENEW_FIELDS = ['token', 'email'] as const;
const RECOVERY_FIELDS = ['email'] as const;

/**
 * Rebuilds a flow request from the named string fields only, so the body main
 * sends never carries anything else the renderer put in the object.
 */
function readFlowInput<K extends FlowField>(
  input: unknown,
  fields: readonly K[]
): { ok: true; value: Record<K, string> } | FlowInputFailure {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'invalid-input', message: 'Expected an object.', issues: ['input must be an object'] };
  }
  const record = input as Record<string, unknown>;
  const value = {} as Record<K, string>;
  const issues: string[] = [];
  for (const field of fields) {
    const raw = record[field];
    const cap = FLOW_FIELD_BYTE_CAPS[field];
    // A UTF-8 byte count is never below the code-unit count, so reject oversize
    // strings before copying them; padding past the cap is refused too.
    if (typeof raw === 'string' && raw.length > cap) {
      issues.push(`${field} exceeds ${cap} byte cap`);
      continue;
    }
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (trimmed.length === 0) issues.push(`${field} is required`);
    else if (TEXT_ENCODER.encode(trimmed).byteLength > cap) issues.push(`${field} exceeds ${cap} byte cap`);
    else value[field] = trimmed;
  }
  if (issues.length > 0) {
    return { ok: false, reason: 'invalid-input', message: 'Invalid license request.', issues };
  }
  return { ok: true, value };
}

async function sendFlow<R>(
  send: () => Promise<R>
): Promise<R | { ok: false; reason: 'server-error'; message: string }> {
  try {
    return await send();
  } catch (error) {
    return {
      ok: false,
      reason: 'server-error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// Typed IPC contract: the `license:*` handlers bind to
// `typedHandle`, so `tsc` checks each handler's return type against the
// contract result. This became possible once the ambient
// `LicensePayloadShape.tier` in `src/types.d.ts` was widened to the full
// canonical 6-tier list (matching `src/shared/license.ts`), so main's
// snapshot type is assignable to the contract's ambient shape.
export function registerLicenseHandlers(
  runtimeSource: LicenseRuntime | PromiseLike<LicenseRuntime>
): void {
  // Register the channels before the window loads, while allowing
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

  // Desktop's parallel of `/licenses/devices/remove`.
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

  // Trial, education and recovery need no license runtime, so they answer
  // even when the runtime failed to start.
  typedHandle('license:start-trial', async (_event, input: unknown): Promise<TrialStartResult> => {
    const check = readFlowInput(input, TRIAL_FIELDS);
    return check.ok ? sendFlow(() => startTrial(check.value)) : check;
  });

  typedHandle(
    'license:start-education',
    async (_event, input: unknown): Promise<EducationStartResult> => {
      const check = readFlowInput(input, EDUCATION_START_FIELDS);
      return check.ok ? sendFlow(() => startEducation(check.value)) : check;
    }
  );

  typedHandle(
    'license:renew-education',
    async (_event, input: unknown): Promise<EducationRenewResult> => {
      const check = readFlowInput(input, EDUCATION_RENEW_FIELDS);
      return check.ok ? sendFlow(() => renewEducation(check.value)) : check;
    }
  );

  typedHandle(
    'license:start-recovery',
    async (_event, input: unknown): Promise<LicenseRecoverResult> => {
      const check = readFlowInput(input, RECOVERY_FIELDS);
      return check.ok ? sendFlow(() => startRecovery(check.value)) : check;
    }
  );
}
