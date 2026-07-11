/**
 * Entitlement + tier gating shared between renderer and main (RL-060).
 *
 * All tier policy lives in this module so limits cannot drift across stores.
 * Callers that need to check "is this action allowed" should ask
 * `isEntitled(tier, entitlement)`; callers that enforce numeric ceilings
 * (tabs, snippets, languages) should read the `FREE_TIER_LIMITS` constant
 * or, better, the helper that accepts a tier and returns the ceiling
 * (Infinity for paid tiers).
 */

import type { LicenseTier } from './license';

export const ENTITLEMENTS = [
  'UNLIMITED_TABS',
  'NPM_PACKAGES',
  'SNIPPETS_UNLIMITED',
  'DEV_UTILITIES',
  'LANGUAGE_PACK_EXTENDED',
  'THEME_PACK_EXTENDED',
  'FONT_PACK_EXTENDED',
  'LOCAL_AI',
  'NOTEBOOK_MODE',
  'EXECUTION_HISTORY',
  'BENCHMARK',
] as const;

export type Entitlement = (typeof ENTITLEMENTS)[number];

/**
 * Canonical free-tier ceilings. Any UI that enforces a numeric limit MUST
 * read from here so upgrading to Pro only has to flip a single source of
 * truth. Paid tiers are treated as unlimited (`Infinity`) — not because
 * they're truly infinite, but because the product does not currently ship a
 * Pro ceiling different from Free that isn't already covered by an
 * entitlement flag above.
 */
export const FREE_TIER_LIMITS = {
  // IT2-D1 — three tabs let Free users compare the core JS/TS/Python
  // workflows before the unlimited-tabs upgrade becomes relevant.
  maxOpenTabs: 3,
  maxSnippets: 5,
  // RL-042 Slice 5 — Ruby (@ruby/wasm-wasi) joins the Free set with
  // the same posture as Python (Pyodide): pure browser WASM, no host
  // binary, no proprietary toolchain. Go / Rust stay Pro because they
  // need a desktop subprocess (or a research-tier WASM compile).
  allowedLanguages: ['javascript', 'typescript', 'python', 'ruby'] as readonly string[],
} as const;

/** Convenience: ceiling for a concrete tier. Paid tiers collapse to Infinity. */
export function tabCeilingForTier(tier: LicenseTier): number {
  return tier === 'free' ? FREE_TIER_LIMITS.maxOpenTabs : Number.POSITIVE_INFINITY;
}

export function snippetCeilingForTier(tier: LicenseTier): number {
  return tier === 'free' ? FREE_TIER_LIMITS.maxSnippets : Number.POSITIVE_INFINITY;
}

/**
 * The Free tier entitlement matrix — everything enumerated here is
 * explicitly denied for `free` and granted for every paid tier. Keep this
 * aligned with the marketing tiers on `linguacode.dev` and the Polar.sh
 * metadata (RL-061).
 */
const FREE_TIER_ENTITLEMENTS: ReadonlySet<Entitlement> = new Set([
  // Free tier access to base product surfaces (for example single-shot
  // Developer Utilities) is modeled by leaving those actions ungated.
  // Entries in this enum represent paid upgrades, so Free currently
  // receives none of them.
]);

const PAID_TIER_ENTITLEMENTS: ReadonlySet<Entitlement> = new Set(ENTITLEMENTS);

export function entitlementsForTier(tier: LicenseTier): ReadonlySet<Entitlement> {
  return tier === 'free' ? FREE_TIER_ENTITLEMENTS : PAID_TIER_ENTITLEMENTS;
}

export function isEntitled(tier: LicenseTier, entitlement: Entitlement): boolean {
  return entitlementsForTier(tier).has(entitlement);
}

/**
 * Numeric gates — same policy but shaped for counting callers (e.g. "am I
 * allowed to open a new tab given I already have N?"). Returns true when
 * the proposed new count is still within budget for the tier.
 */
export function withinTabBudget(tier: LicenseTier, proposedCount: number): boolean {
  return proposedCount <= tabCeilingForTier(tier);
}

export function withinSnippetBudget(tier: LicenseTier, proposedCount: number): boolean {
  return proposedCount <= snippetCeilingForTier(tier);
}

export function isLanguageAllowed(tier: LicenseTier, language: string): boolean {
  if (tier !== 'free') return true;
  return FREE_TIER_LIMITS.allowedLanguages.includes(language);
}
