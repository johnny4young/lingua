/**
 * License token mint helper — assembles a `LicensePayload` from
 * webhook context and signs it via `sign.ts`.
 *
 * Centralises the contract between Polar event types and the renderer
 * entitlement matrix:
 *
 *   - `lingua_monthly`   → tier `'pro'`, expires_at = subscription period_end
 *   - `lingua_lifetime`  → tier `'pro_lifetime'`, expires_at = null
 *   - `lingua_team`      → tier `'team'`, expires_at = subscription period_end
 *   - `lingua_trial`     → tier `'trial'` (Slice 4)
 *   - `lingua_education` → tier `'education'` (Slice 4)
 *
 * The renderer's `useEntitlement()` collapses tier → entitlements set;
 * here we only emit the `tier` string + the canonical entitlement
 * keys the renderer expects.
 */

import { signLicenseToken, type LicensePayload, type TokenSignResult } from './sign';

export type LicenseProductId =
  | 'lingua_monthly'
  | 'lingua_lifetime'
  | 'lingua_team'
  | 'lingua_trial'
  | 'lingua_education';

/**
 * Same constant the renderer-side `KNOWN_ENTITLEMENTS` references; the
 * paid-tier collapse logic in `src/shared/entitlements.ts` accepts any
 * subset, so emitting the full set future-proofs against new feature
 * flags being added without the issuer needing to re-mint old tokens.
 */
export const PAID_ENTITLEMENTS: readonly string[] = [
  'tabs',
  'snippets',
  'languages-extended',
  'dev-utilities',
  'variable-inspector',
  'themes-extra',
  'fonts-extra',
  'deep-links',
  'execution-history',
  'benchmarking',
  'local-ai',
  'notebook-mode',
];

const TIER_BY_PRODUCT: Record<LicenseProductId, LicensePayload['tier']> = {
  lingua_monthly: 'pro',
  lingua_lifetime: 'pro_lifetime',
  lingua_team: 'team',
  lingua_trial: 'trial',
  lingua_education: 'education',
};

export function tierForProduct(productId: LicenseProductId): LicensePayload['tier'] {
  return TIER_BY_PRODUCT[productId];
}

export interface MintInput {
  /** Stable `licenses.id` row id. Lets /licenses/status find the row after token refresh. */
  licenseId: string;
  productId: LicenseProductId;
  issuedTo: string;
  /** Epoch seconds. */
  issuedAt: number;
  /**
   * Epoch seconds; null for `lingua_lifetime` (no expiry). Required
   * for monthly + team + trial + education.
   */
  expiresAt: number | null;
  /**
   * Epoch seconds at which offline grace begins. Defaults to
   * `expiresAt` for time-bound tiers, or `issuedAt + 365d` for lifetime.
   */
  supportWindowEndsAt: number;
}

/**
 * Build the canonical `LicensePayload` shape. Pure function — no
 * crypto. Tested independently from the signer so the payload
 * surface stays stable across implementations.
 */
export function buildLicensePayload(input: MintInput): LicensePayload {
  return {
    licenseId: input.licenseId,
    productId: input.productId,
    tier: tierForProduct(input.productId),
    issuedTo: input.issuedTo.toLowerCase().trim(),
    issuedAt: new Date(input.issuedAt * 1000).toISOString(),
    supportWindowEndsAt: new Date(input.supportWindowEndsAt * 1000).toISOString(),
    entitlements: PAID_ENTITLEMENTS,
  };
}

/**
 * Mint + sign in one call. Wraps `buildLicensePayload` + `signLicenseToken`.
 * Slice 2 callers reach this from the Polar webhook handler.
 */
export async function mintAndSignToken(
  input: MintInput,
  privateKeyJwk: JsonWebKey
): Promise<TokenSignResult> {
  return signLicenseToken(buildLicensePayload(input), privateKeyJwk);
}
