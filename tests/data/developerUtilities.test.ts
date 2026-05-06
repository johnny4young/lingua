import { describe, expect, it } from 'vitest';
import {
  DEVELOPER_UTILITIES,
  DEFAULT_DEVELOPER_UTILITY_ID,
  findDeveloperUtility,
  type DeveloperUtilityDefinition,
} from '@/data/developerUtilities';

describe('DEVELOPER_UTILITIES catalog', () => {
  it('keeps utility ids unique', () => {
    const ids = DEVELOPER_UTILITIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares non-empty title / action / description i18n keys for every entry', () => {
    for (const utility of DEVELOPER_UTILITIES) {
      expect(utility.titleKey, utility.id).toMatch(/^utilities\.tool\./u);
      expect(utility.actionLabelKey, utility.id).toMatch(/^utilities\.tool\./u);
      expect(utility.descriptionKey, utility.id).toMatch(/^utilities\.tool\./u);
    }
  });

  it('declares non-empty keyword arrays', () => {
    for (const utility of DEVELOPER_UTILITIES) {
      expect(utility.keywords.length, utility.id).toBeGreaterThan(0);
    }
  });

  it('default utility id resolves to a real catalog entry', () => {
    const found = DEVELOPER_UTILITIES.find(
      (utility) => utility.id === DEFAULT_DEVELOPER_UTILITY_ID
    );
    expect(found).toBeDefined();
  });

  it('findDeveloperUtility falls back when id is unknown', () => {
    const fallback = findDeveloperUtility(
      'this-is-not-a-real-id' as unknown as DeveloperUtilityDefinition['id']
    );
    expect(fallback.id).toBe(DEVELOPER_UTILITIES[0]!.id);
  });

  describe('aliases (RL-069 Slice 1)', () => {
    const withAliases = DEVELOPER_UTILITIES.filter(
      (utility) => utility.aliases !== undefined
    );

    it('seeds aliases on a meaningful subset of the catalog', () => {
      // Slice 1 deliberately scopes aliases to ~15 panels with obvious
      // shorthand. Asserting >= 10 so future maintenance can prune
      // a duplicate or two without breaking the test, while still
      // catching a regression that drops them altogether.
      expect(withAliases.length).toBeGreaterThanOrEqual(10);
    });

    it('each aliased utility carries lowercase tokens with no spaces', () => {
      for (const utility of withAliases) {
        for (const alias of utility.aliases ?? []) {
          expect(alias, `${utility.id}: alias must be non-empty`).not.toBe('');
          expect(alias, `${utility.id}: alias must be lowercase`).toBe(alias.toLowerCase());
          expect(alias, `${utility.id}: alias must not contain whitespace`).not.toMatch(/\s/u);
        }
      }
    });

    it('aliases stay disjoint from the same entry’s keywords (avoid duplication)', () => {
      // This guard catches the natural temptation to copy a token from
      // keywords into aliases. They serve different roles: keywords
      // describe, aliases abbreviate. Duplication doesn't break the
      // search but bloats the catalog and confuses future readers.
      for (const utility of withAliases) {
        const keywordSet = new Set(utility.keywords.map((kw) => kw.toLowerCase()));
        for (const alias of utility.aliases ?? []) {
          expect(
            keywordSet.has(alias),
            `${utility.id}: alias "${alias}" duplicates a keyword`
          ).toBe(false);
        }
      }
    });

    it('seeds the b64 / ts / md shorthands users actually type', () => {
      const findById = (id: DeveloperUtilityDefinition['id']) =>
        DEVELOPER_UTILITIES.find((utility) => utility.id === id);

      expect(findById('base64')?.aliases).toContain('b64');
      expect(findById('timestamp')?.aliases).toContain('ts');
      expect(findById('markdown-preview')?.aliases).toContain('md');
    });
  });
});
