import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it } from 'node:test';

import { UTILITIES, UTILITY_COUNT } from '../src/lib/utilities.ts';

/**
 * The utility count is marketing copy that has to agree with the catalog.
 *
 * It drifted once already: the features page named six panels and promised
 * "and twenty-three more" (29 total) while the catalog had grown to 31, and a
 * grid comment claimed "fits all 31 panels" directly above the arithmetic
 * "6 cols x 5 rows = 30 cells".
 *
 * Astro components import `UTILITY_COUNT`, so they cannot drift. Two kinds of
 * surface cannot import it:
 *
 *   - the i18n bundles, because `i18n/en.ts` -> `lib/utilities` -> `lib/i18n`
 *     -> `i18n/en.ts` closes a module cycle that is only harmless while that
 *     last edge stays a type-only import;
 *   - the docs markdown, which has no module system at all.
 *
 * Those are what this test covers. It reads the raw source rather than the
 * rendered page on purpose: the point is to fail the moment someone adds a
 * utility without updating the prose, not after a build.
 */

const websiteRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (relative: string) =>
  readFileSync(path.join(websiteRoot, relative), 'utf8');

/**
 * Surfaces that hardcode the number and cannot import it.
 *
 * Each one carries the context the count is supposed to appear in, not just
 * the digits. A bare `source.includes('31')` would be satisfied by any
 * unrelated 31 that wanders into the file — a date, a version, a pixel value —
 * so the guard would keep passing with the actual copy stale or deleted.
 */
const GUARDED: Array<{ file: string; where: string; context: (count: number) => RegExp }> = [
  {
    file: 'src/i18n/en.ts',
    where: "the proof-row entry (value: '<count>')",
    context: count => new RegExp(`value:\\s*'${count}'`, 'u'),
  },
  {
    file: 'src/i18n/es.ts',
    where: "the proof-row entry (value: '<count>')",
    context: count => new RegExp(`value:\\s*'${count}'`, 'u'),
  },
  {
    file: 'src/content/docs/en/utilities.md',
    where: 'the frontmatter description',
    context: count => new RegExp(`^description:.*\\b${count}\\b`, 'mu'),
  },
  {
    file: 'src/content/docs/es/utilities.md',
    where: 'the frontmatter description',
    context: count => new RegExp(`^description:.*\\b${count}\\b`, 'mu'),
  },
];

describe('utility count stays in step with the catalog', () => {
  it('derives the exported count from the catalog itself', () => {
    assert.equal(UTILITY_COUNT, UTILITIES.length);
    assert.ok(UTILITY_COUNT > 0, 'an empty catalog means the import broke');
  });

  it('has no duplicate ids inflating the count', () => {
    const ids = UTILITIES.map(utility => utility.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate utility id');
  });

  it('quotes the current count on every surface that cannot import it', () => {
    for (const { file, where, context } of GUARDED) {
      assert.match(
        read(file),
        context(UTILITY_COUNT),
        `${file} does not carry ${UTILITY_COUNT} in ${where}; update the copy after changing the catalog`
      );
    }
  });

  it('quotes no stale neighbouring count', () => {
    // A bare regex for "any number" would trip over years and version numbers,
    // so check the values an off-by-a-few edit would actually leave behind.
    const stale = [UTILITY_COUNT - 2, UTILITY_COUNT - 1, UTILITY_COUNT + 1, UTILITY_COUNT + 2];
    for (const { file } of GUARDED) {
      const source = read(file);
      for (const value of stale) {
        for (const phrase of [
          `${value} utilities`,
          `${value} utilidades`,
          `${value} panels`,
          `${value} paneles`,
          `${value}-panel`,
        ]) {
          assert.ok(
            !source.includes(phrase),
            `${file} still says "${phrase}" but the catalog has ${UTILITY_COUNT}`
          );
        }
      }
    }
  });

  it('leaves no spelled-out remainder in the features blurb', () => {
    // The original bug was a word, not a numeral: "and twenty-three more".
    // Words cannot be interpolated from the catalog, so they must not come back.
    const features = read('src/pages/features.astro');
    for (const word of [
      'twenty-three',
      'veintitrés',
      'twenty-five',
      'veinticinco',
      'twenty-four',
      'veinticuatro',
    ]) {
      assert.ok(
        !features.includes(word),
        `features.astro spells out "${word}" instead of deriving it from UTILITY_COUNT`
      );
    }
    assert.ok(
      features.includes('UTILITY_COUNT'),
      'features.astro should derive its counts from the catalog'
    );
  });
});
