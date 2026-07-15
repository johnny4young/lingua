/**
 * Version handshake for machine-readable license-server responses.
 *
 * The accepted versions are intentionally a closed set. A client must
 * understand the full response contract before it reads any payload fields;
 * silently accepting a newer envelope could turn a server-side contract
 * change into an incorrect entitlement decision.
 */

export const LICENSE_SERVER_PROTOCOL_VERSION = 1 as const;

export const ACCEPTED_LICENSE_SERVER_PROTOCOL_VERSIONS = [LICENSE_SERVER_PROTOCOL_VERSION] as const;

export type LicenseServerProtocolVersion =
  (typeof ACCEPTED_LICENSE_SERVER_PROTOCOL_VERSIONS)[number];

export interface LicenseServerProtocolEnvelope {
  protocolVersion: LicenseServerProtocolVersion;
}

export type LicenseServerProtocolValidation =
  | {
      ok: true;
      body: Record<string, unknown> & LicenseServerProtocolEnvelope;
    }
  | {
      ok: false;
      reason: 'unsupported-protocol';
    };

/**
 * Validate the protocol envelope before callers inspect or cast its payload.
 * Missing, malformed, and unknown versions intentionally collapse to the same
 * typed failure so raw server details never reach user-facing copy.
 */
export function validateLicenseServerProtocol(body: unknown): LicenseServerProtocolValidation {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'unsupported-protocol' };
  }

  const record = body as Record<string, unknown>;
  const version = record.protocolVersion;
  if (
    typeof version !== 'number' ||
    !ACCEPTED_LICENSE_SERVER_PROTOCOL_VERSIONS.some(acceptedVersion => acceptedVersion === version)
  ) {
    return { ok: false, reason: 'unsupported-protocol' };
  }

  return {
    ok: true,
    body: record as Record<string, unknown> & LicenseServerProtocolEnvelope,
  };
}

/**
 * Drop the transport envelope once the version handshake has passed.
 *
 * `protocolVersion` is a wire concern: the domain success/failure types
 * (`ActivateSuccess`, `StatusSuccess`, `TrialStartSuccess`, …) deliberately
 * do not declare it, so returning the validated body as-is would leave the
 * field on the runtime object and let it ride into renderer state and the
 * Electron IPC payloads. Strip it here so the returned payload matches the
 * declared contract exactly.
 */
export function stripProtocolEnvelope<T extends Record<string, unknown>>(
  body: T & LicenseServerProtocolEnvelope
): T {
  const { protocolVersion: _protocolVersion, ...payload } = body;
  void _protocolVersion;
  return payload as unknown as T;
}
