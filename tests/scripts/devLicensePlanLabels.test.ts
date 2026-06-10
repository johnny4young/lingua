import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEV_LICENSE_PLAN_LABELS,
  VALID_DEV_LICENSE_TIERS,
} from '../../scripts/dev-license-shared.mjs';

/**
 * Contract guard for the dev-license banner's tier → plan-label map. The
 * banner prints the in-app plan label (`tier: pro → shows as "Monthly"`) so a
 * developer minting `--tier pro` is not surprised when Settings → License says
 * "Monthly" rather than "Pro". That hint is only useful if it stays in lockstep
 * with the real `license.tier.*` i18n the app renders — this test pins it.
 *
 * Background (verified against license-server): the Polar product
 * `lingua_monthly` maps to internal tier `pro` (public plan "Monthly"), and
 * `lingua_lifetime` maps to `pro_lifetime` (public plan "Pro"). So
 * `pro → Monthly` is correct by design, NOT a label bug.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enCommon = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'),
    'utf8'
  )
) as Record<string, string>;

describe('dev-license plan-label banner map', () => {
  it('matches the in-app license.tier.* labels for every mintable tier', () => {
    for (const tier of VALID_DEV_LICENSE_TIERS) {
      expect(
        DEV_LICENSE_PLAN_LABELS[tier],
        `DEV_LICENSE_PLAN_LABELS.${tier} must mirror license.tier.${tier}`
      ).toBe(enCommon[`license.tier.${tier}`]);
    }
  });

  it('keeps the deliberate pro=Monthly / pro_lifetime=Pro split', () => {
    // Regression pin: changing `pro` to "Pro" would collide with the
    // lifetime tier and misrepresent the Monthly subscription.
    expect(DEV_LICENSE_PLAN_LABELS.pro).toBe('Monthly');
    expect(DEV_LICENSE_PLAN_LABELS.pro_lifetime).toBe('Pro');
  });
});
