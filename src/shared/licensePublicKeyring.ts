/**
 * Parse the public trust anchor shared by the app and the license issuer.
 * This leaf owns only JWK shape and rotation-list validation; the two
 * surfaces keep their distinct token, entitlement, and temporal policies.
 */
export type LicensePublicKeyring = readonly JsonWebKey[];

const MAX_LICENSE_PUBLIC_KEYS = 3;

function isEd25519PublicJwk(value: unknown): value is JsonWebKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as JsonWebKey;
  return (
    candidate.kty === 'OKP' &&
    candidate.crv === 'Ed25519' &&
    typeof candidate.x === 'string' &&
    candidate.x.length > 0 &&
    candidate.d === undefined
  );
}

/**
 * Accept a historical single JWK or an ordered rotation keyring. Reject the
 * whole value rather than dropping a malformed, duplicate, or private entry:
 * the shipped trust boundary must match the operator's rotation evidence.
 */
export function parseLicensePublicKeyring(raw: string | undefined | null): LicensePublicKeyring {
  if (typeof raw !== 'string' || raw.length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  if (candidates.length === 0 || candidates.length > MAX_LICENSE_PUBLIC_KEYS) return [];
  if (!candidates.every(isEd25519PublicJwk)) return [];

  const identities = candidates.map(
    candidate => `${candidate.kty}:${candidate.crv}:${candidate.x}`
  );
  if (new Set(identities).size !== identities.length) return [];
  return candidates;
}
