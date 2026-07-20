import { describe, expect, it } from 'vitest';
import { DEVELOPER_UTILITIES } from '../../src/renderer/data/developerUtilities';
import {
  CATEGORY_SORTED_UTILITIES,
  UTILITY_CATEGORY,
  UTILITY_CATEGORY_LABEL_KEY,
  UTILITY_CATEGORY_ORDER,
} from '../../src/renderer/data/utilityCategories';

describe('utilityCategories', () => {
  it('assigns every catalog utility to a category', () => {
    for (const utility of DEVELOPER_UTILITIES) {
      expect(UTILITY_CATEGORY[utility.id]).toBeTruthy();
    }
  });

  it('has a label key for every category in the order list', () => {
    for (const category of UTILITY_CATEGORY_ORDER) {
      expect(UTILITY_CATEGORY_LABEL_KEY[category]).toMatch(/^utilities\.category\./);
    }
  });

  it('the sorted browse list is a lossless permutation of the catalog', () => {
    expect(CATEGORY_SORTED_UTILITIES).toHaveLength(DEVELOPER_UTILITIES.length);
    const sortedIds = [...CATEGORY_SORTED_UTILITIES]
      .map((u) => u.id)
      .sort();
    const catalogIds = [...DEVELOPER_UTILITIES].map((u) => u.id).sort();
    expect(sortedIds).toEqual(catalogIds);
  });

  it('groups categories contiguously in the declared order', () => {
    const seenOrder: string[] = [];
    for (const utility of CATEGORY_SORTED_UTILITIES) {
      const category = UTILITY_CATEGORY[utility.id];
      if (seenOrder[seenOrder.length - 1] !== category) {
        seenOrder.push(category);
      }
    }
    // Each category appears exactly once (contiguous), following the
    // declared display order (categories with no utilities are skipped).
    expect(seenOrder).toEqual(
      UTILITY_CATEGORY_ORDER.filter((category) =>
        CATEGORY_SORTED_UTILITIES.some((u) => UTILITY_CATEGORY[u.id] === category)
      )
    );
    expect(new Set(seenOrder).size).toBe(seenOrder.length);
  });
});
