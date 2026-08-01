import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FREE_TIER_LIMITS } from '../../src/shared/entitlements';

const ROOT = resolve(__dirname, '../..');

describe('public product contract', () => {
  it('keeps website and press copy aligned with executable entitlement limits', () => {
    const output = execFileSync('node', ['website/scripts/check-public-product-copy.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
    });

    expect(output).toContain(
      `Free=${FREE_TIER_LIMITS.maxOpenTabs} tabs/${FREE_TIER_LIMITS.maxSnippets} snippets/${FREE_TIER_LIMITS.allowedLanguages.join(', ')}`
    );
  });
});
