/**
 * `POST /trials/start`. The request itself lives in
 * `src/shared/licenseFlowRequests.ts`; see `licenseFlowTransport.ts` for how
 * desktop and web send it. Returns a tagged union and never throws.
 *
 * The success branch returns the signed token in the body so the
 * caller can feed it directly into `licenseStore.setLicenseToken`
 * for auto-paste — even if the welcome email failed to send.
 */

import type { TrialStartInput, TrialStartResult } from '../../shared/licenseServerTypes';
import { requestTrialStart } from '../../shared/licenseFlowRequests';
import { readLicenseFlowBridge, readLicenseServerBaseUrl, viaBridge } from './licenseFlowTransport';

export type {
  TrialStartInput,
  TrialStartResult,
  TrialStartSuccess,
  TrialStartFailureReason,
} from '../../shared/licenseServerTypes';

export async function startTrial(input: TrialStartInput): Promise<TrialStartResult> {
  const bridge = readLicenseFlowBridge();
  if (bridge) return viaBridge(() => bridge.startTrial(input));
  return requestTrialStart(readLicenseServerBaseUrl(), input);
}
