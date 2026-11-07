/**
 * Education flow requests. See `licenseFlowTransport.ts` for how desktop and
 * web send them; both return tagged unions and never throw.
 *
 *   POST /education/start  — magic-link first step. Body returns
 *                            { ok: true, pending: true, message }
 *                            on success. Renderer shows a "check
 *                            your email" notice; the actual token
 *                            arrives after the user clicks the
 *                            confirm link.
 *   POST /education/renew  — re-mints + extends 1y. Token returned
 *                            in `refreshedToken` for auto-pickup.
 *
 * `GET /education/confirm` is intentionally NOT wrapped — the user
 * reaches it by clicking the email link, so the renderer never
 * calls it.
 */

import type {
  EducationRenewInput,
  EducationRenewResult,
  EducationStartInput,
  EducationStartResult,
} from '../../shared/licenseServerTypes';
import { requestEducationRenew, requestEducationStart } from '../../shared/licenseFlowRequests';
import { readLicenseFlowBridge, readLicenseServerBaseUrl, viaBridge } from './licenseFlowTransport';

export type {
  EducationStartInput,
  EducationStartResult,
  EducationStartPending,
  EducationStartFailureReason,
  EducationRenewInput,
  EducationRenewResult,
  EducationRenewSuccess,
  EducationRenewFailureReason,
} from '../../shared/licenseServerTypes';

export async function startEducation(input: EducationStartInput): Promise<EducationStartResult> {
  const bridge = readLicenseFlowBridge();
  if (bridge) return viaBridge(() => bridge.startEducation(input));
  return requestEducationStart(readLicenseServerBaseUrl(), input);
}

export async function renewEducation(input: EducationRenewInput): Promise<EducationRenewResult> {
  const bridge = readLicenseFlowBridge();
  if (bridge) return viaBridge(() => bridge.renewEducation(input));
  return requestEducationRenew(readLicenseServerBaseUrl(), input);
}
