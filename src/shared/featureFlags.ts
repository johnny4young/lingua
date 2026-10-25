/**
 * Typed registry of experimental features. Every flag is off until turned on
 * in Settings › Labs; a flag leaves this list once its feature ships for everyone.
 */

/** Each id reads its copy from `settings.labs.flag.<id>.label` and `.description`. */
export const FEATURE_FLAG_IDS = ['networkPolicy', 'dbClient', 'editRows', 'httpScopes', 'httpChainTags'] as const;

export type FeatureFlagId = (typeof FEATURE_FLAG_IDS)[number];
export type FeatureFlagState = Partial<Record<FeatureFlagId, boolean>>;

/** Keeps known flags that are explicitly on; drops everything else. */
export function sanitizeFeatureFlags(value: unknown): FeatureFlagState {
  if (!value || typeof value !== 'object') return {};
  const flags: FeatureFlagState = {};
  for (const id of FEATURE_FLAG_IDS) {
    if ((value as Record<string, unknown>)[id] === true) flags[id] = true;
  }
  return flags;
}
