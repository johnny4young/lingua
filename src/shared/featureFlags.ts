/**
 * Typed registry of experimental features. Every flag is off until turned on
 * in Settings › Labs; a flag leaves this list once its feature ships for everyone.
 */

export const FEATURE_FLAGS = {
  networkPolicy: {
    labelKey: 'settings.labs.flag.networkPolicy.label',
    descriptionKey: 'settings.labs.flag.networkPolicy.description',
  },
  dbClient: {
    labelKey: 'settings.labs.flag.dbClient.label',
    descriptionKey: 'settings.labs.flag.dbClient.description',
  },
} as const;

export type FeatureFlagId = keyof typeof FEATURE_FLAGS;
export type FeatureFlagState = Partial<Record<FeatureFlagId, boolean>>;

export const FEATURE_FLAG_IDS = Object.keys(FEATURE_FLAGS) as FeatureFlagId[];

/** Keeps known flags that are explicitly on; drops everything else. */
export function sanitizeFeatureFlags(value: unknown): FeatureFlagState {
  if (!value || typeof value !== 'object') return {};
  const flags: FeatureFlagState = {};
  for (const id of FEATURE_FLAG_IDS) {
    if ((value as Record<string, unknown>)[id] === true) flags[id] = true;
  }
  return flags;
}
