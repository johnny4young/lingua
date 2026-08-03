import { describe, expect, it } from 'vitest';
import {
  DEVELOPER_UTILITIES,
  DEFAULT_DEVELOPER_UTILITY_ID,
  findDeveloperUtility,
  type DeveloperUtilityDefinition,
} from '@/data/developerUtilities';
import {
  DEVELOPER_UTILITY_CATALOG,
  findDeveloperUtilityCatalogEntry,
} from '@/data/developerUtilityCatalog';
import { findDeveloperUtilityDetector } from '@/data/developerUtilityDetectors';

describe('DEVELOPER_UTILITIES catalog', () => {
  it('keeps startup-safe identity separate from complete reference metadata', () => {
    expect(DEVELOPER_UTILITIES).toHaveLength(DEVELOPER_UTILITY_CATALOG.length);
    expect(DEVELOPER_UTILITIES.map(entry => entry.id)).toEqual(
      DEVELOPER_UTILITY_CATALOG.map(entry => entry.id)
    );

    for (const utility of DEVELOPER_UTILITY_CATALOG) {
      expect(utility.titleKey).toMatch(/^utilities\.tool\./u);
      expect(utility).not.toHaveProperty('actionLabelKey');
      expect(utility).not.toHaveProperty('descriptionKey');
      expect(utility).not.toHaveProperty('keywords');
      expect(utility).not.toHaveProperty('aliases');
    }
  });

  it('keeps utility ids unique', () => {
    const ids = DEVELOPER_UTILITIES.map(entry => entry.id);
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

  it('keeps only workflow automation behind the DEV_UTILITIES entitlement', () => {
    for (const utility of DEVELOPER_UTILITIES) {
      if (utility.id === 'utility-pipelines') {
        expect(utility.requiresEntitlement).toBe('DEV_UTILITIES');
      } else {
        expect(utility.requiresEntitlement, utility.id).toBeUndefined();
      }
    }
  });

  it('default utility id resolves to a real catalog entry', () => {
    const found = DEVELOPER_UTILITIES.find(utility => utility.id === DEFAULT_DEVELOPER_UTILITY_ID);
    expect(found).toBeDefined();
  });

  it('findDeveloperUtility falls back when id is unknown', () => {
    const fallback = findDeveloperUtility(
      'this-is-not-a-real-id' as unknown as DeveloperUtilityDefinition['id']
    );
    expect(fallback.id).toBe(DEVELOPER_UTILITIES[0]!.id);
    expect(
      findDeveloperUtilityCatalogEntry(
        'this-is-not-a-real-id' as unknown as DeveloperUtilityDefinition['id']
      ).id
    ).toBe(DEVELOPER_UTILITY_CATALOG[0]!.id);
  });

  describe('aliases ', () => {
    const withAliases = DEVELOPER_UTILITIES.filter(utility => utility.aliases !== undefined);

    it('seeds aliases on a meaningful subset of the catalog', () => {
      // implementation deliberately scopes aliases to ~15 panels with obvious
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
        const keywordSet = new Set(utility.keywords.map(kw => kw.toLowerCase()));
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
        DEVELOPER_UTILITIES.find(utility => utility.id === id);

      expect(findById('base64')?.aliases).toContain('b64');
      expect(findById('timestamp')?.aliases).toContain('ts');
      expect(findById('markdown-preview')?.aliases).toContain('md');
    });
  });

  describe('detector registry', () => {
    // Pure generators that intentionally have no input detector.
    // The toolbar hides the ⚡ Apply button for these panels.
    const GENERATOR_IDS: ReadonlySet<DeveloperUtilityDefinition['id']> = new Set([
      'random-string',
      'mock-data',
      'lorem-ipsum',
      // implementation — Utility Pipelines panel takes its input
      // from the user-defined first step + the pipeline editor; the
      // overlay's ⚡ Apply button doesn't apply. Treated as a
      // generator from the catalog's POV.
      'utility-pipelines',
    ]);

    it('declares detect on every non-generator panel', () => {
      for (const utility of DEVELOPER_UTILITIES) {
        const detect = findDeveloperUtilityDetector(utility.id);
        if (GENERATOR_IDS.has(utility.id)) {
          expect(detect, `${utility.id} should opt out`).toBeNull();
          continue;
        }
        expect(typeof detect, `${utility.id} should declare detect`).toBe('function');
      }
    });

    it('detect predicates accept the generalised inputs shape', () => {
      // The signature was widened in implementation to support diff and regex,
      // which need both a primary and a secondary value. Every other
      // panel ignores `secondary` — passing it must still be safe.
      for (const utility of DEVELOPER_UTILITIES) {
        const detect = findDeveloperUtilityDetector(utility.id);
        if (!detect) continue;
        const result = detect({ primary: '', secondary: '' });
        expect(typeof result, `${utility.id} must return a boolean`).toBe('boolean');
      }
    });

    it('detect returns false for the empty-input baseline', () => {
      // String Inspector still rejects the truly empty baseline, while
      // keeping whitespace-only characters inspectable because those
      // codepoints are exactly what the tool helps users diagnose.
      for (const utility of DEVELOPER_UTILITIES) {
        const detect = findDeveloperUtilityDetector(utility.id);
        if (!detect) continue;
        expect(detect({ primary: '' }), `${utility.id} on empty`).toBe(false);
      }
    });

    it('base64-image detects data URIs, not raw base64 payloads', () => {
      const base64Image = findDeveloperUtilityDetector('base64-image');
      expect(base64Image?.({ primary: 'data:image/png;base64,iVBORw0KGgo=' })).toBe(true);
      expect(base64Image?.({ primary: 'iVBORw0KGgo=' })).toBe(false);
    });

    it('regex and diff use the secondary input', () => {
      const regex = findDeveloperUtilityDetector('regex');
      const diff = findDeveloperUtilityDetector('diff');
      expect(regex?.({ primary: '\\d+' })).toBe(false);
      expect(regex?.({ primary: '\\d+', secondary: 'abc 123' })).toBe(true);
      expect(diff?.({ primary: 'left' })).toBe(false);
      expect(diff?.({ primary: 'left', secondary: 'right' })).toBe(true);
    });
  });
});
