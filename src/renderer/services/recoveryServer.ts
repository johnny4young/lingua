/**
 * `POST /licenses/recover/start` (magic-link recovery flow). See
 * `licenseFlowTransport.ts` for how desktop and web send it; it returns a
 * tagged union and never throws.
 *
 * The worker is no-info-leak: it ALWAYS responds with the same
 * pending shape regardless of whether the email matches a known
 * license, hits a rate-limit, or is empty (per LICENSING_ADR
 * Decision 7). The renderer mirrors that shape — we never
 * surface differential UX based on whether the email exists.
 *
 * `GET /licenses/recover/confirm` is intentionally NOT wrapped —
 * the user reaches it by clicking the email link, the renderer
 * never calls it.
 */

import type { LicenseRecoverInput, LicenseRecoverResult } from '../../shared/licenseServerTypes';
import { requestRecoveryStart } from '../../shared/licenseFlowRequests';
import { readLicenseFlowBridge, readLicenseServerBaseUrl, viaBridge } from './licenseFlowTransport';

export type {
  LicenseRecoverInput,
  LicenseRecoverResult,
  LicenseRecoverPending,
  LicenseRecoverFailureReason,
} from '../../shared/licenseServerTypes';

export async function startRecovery(input: LicenseRecoverInput): Promise<LicenseRecoverResult> {
  const bridge = readLicenseFlowBridge();
  if (bridge) return viaBridge(() => bridge.startRecovery(input));
  return requestRecoveryStart(readLicenseServerBaseUrl(), input);
}
