/**
 * Guards the RL-060 tier policy. Every Free-tier ceiling lives in one place
 * and paid tiers collapse to the full entitlement set; this test locks that
 * invariant so an accidental refactor cannot silently grant paid features
 * to Free or vice versa.
 */

import { describe, expect, it } from 'vitest';
import {
  ENTITLEMENTS,
  FREE_TIER_LIMITS,
  entitlementsForTier,
  isEntitled,
  isLanguageAllowed,
  snippetCeilingForTier,
  tabCeilingForTier,
  withinSnippetBudget,
  withinTabBudget,
} from '../../src/shared/entitlements';
import { LICENSE_TIERS } from '../../src/shared/license';

describe('entitlements policy (RL-060)', () => {
  it('ENTITLEMENTS enum covers the 11 entries named in the RL-060 scope', () => {
    expect([...ENTITLEMENTS].sort()).toEqual(
      [
        'BENCHMARK',
        'DEV_UTILITIES',
        'EXECUTION_HISTORY',
        'FONT_PACK_EXTENDED',
        'LANGUAGE_PACK_EXTENDED',
        'LOCAL_AI',
        'NOTEBOOK_MODE',
        'NPM_PACKAGES',
        'SNIPPETS_UNLIMITED',
        'THEME_PACK_EXTENDED',
        'UNLIMITED_TABS',
      ].sort()
    );
  });

  it('Free tier denies every paid entitlement', () => {
    for (const entitlement of ENTITLEMENTS) {
      expect(isEntitled('free', entitlement)).toBe(false);
    }
  });

  it('Every paid tier grants every entitlement', () => {
    for (const tier of LICENSE_TIERS) {
      if (tier === 'free') continue;
      for (const entitlement of ENTITLEMENTS) {
        expect(isEntitled(tier, entitlement)).toBe(true);
      }
    }
  });

  it('Free ceilings are exactly the documented numbers (1 tab, 5 snippets, 3 languages)', () => {
    expect(FREE_TIER_LIMITS.maxOpenTabs).toBe(1);
    expect(FREE_TIER_LIMITS.maxSnippets).toBe(5);
    expect([...FREE_TIER_LIMITS.allowedLanguages].sort()).toEqual([
      'javascript',
      'python',
      'typescript',
    ]);
  });

  it('Paid tiers collapse tab and snippet ceilings to Infinity', () => {
    expect(tabCeilingForTier('pro')).toBe(Number.POSITIVE_INFINITY);
    expect(snippetCeilingForTier('pro_lifetime')).toBe(Number.POSITIVE_INFINITY);
    expect(tabCeilingForTier('trial')).toBe(Number.POSITIVE_INFINITY);
    expect(snippetCeilingForTier('education')).toBe(Number.POSITIVE_INFINITY);
  });

  it('withinTabBudget respects Free ceiling and waves paid tiers through', () => {
    expect(withinTabBudget('free', 1)).toBe(true);
    expect(withinTabBudget('free', 2)).toBe(false);
    expect(withinTabBudget('pro', 100)).toBe(true);
  });

  it('withinSnippetBudget enforces Free ceiling and waves paid tiers through', () => {
    expect(withinSnippetBudget('free', 5)).toBe(true);
    expect(withinSnippetBudget('free', 6)).toBe(false);
    expect(withinSnippetBudget('team', 10_000)).toBe(true);
  });

  it('isLanguageAllowed locks Free to JS/TS/Python and grants everything to paid tiers', () => {
    expect(isLanguageAllowed('free', 'javascript')).toBe(true);
    expect(isLanguageAllowed('free', 'typescript')).toBe(true);
    expect(isLanguageAllowed('free', 'python')).toBe(true);
    expect(isLanguageAllowed('free', 'go')).toBe(false);
    expect(isLanguageAllowed('free', 'rust')).toBe(false);
    expect(isLanguageAllowed('pro', 'rust')).toBe(true);
  });

  it('entitlementsForTier returns readonly sets so callers cannot mutate the policy', () => {
    const set = entitlementsForTier('pro');
    expect(set.size).toBe(ENTITLEMENTS.length);
    // Readonly contract is TypeScript-level; still assert the instance is a Set
    // so duck-typing doesn't let arrays sneak through.
    expect(set).toBeInstanceOf(Set);
  });
});
