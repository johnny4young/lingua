/**
 * RL-095 Slice 1 — guard `docs/CAPABILITY_MATRIX.md` against drift.
 *
 * The doc carries an auto-derived fenced section between the
 * `AUTO-DERIVED:LANGUAGE_SUPPORT_PROFILES` markers. This test reads
 * the doc, locates the fences, regenerates the expected content
 * from `LANGUAGE_SUPPORT_PROFILES`, and asserts byte equality. On
 * failure the test output includes the expected block so the
 * human can copy-paste-fix.
 *
 * The same `renderLanguageScorecardMarkdown` helper is consumed by
 * the palette command (fold F), so a passing test means the
 * clipboard payload matches the doc verbatim.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderLanguageScorecardMarkdown } from '../../src/shared/languageSupport';

const DOC_PATH = path.resolve(
  process.cwd(),
  'docs/CAPABILITY_MATRIX.md'
);
const START_MARKER = '<!-- AUTO-DERIVED:LANGUAGE_SUPPORT_PROFILES:START -->';
const END_MARKER = '<!-- AUTO-DERIVED:LANGUAGE_SUPPORT_PROFILES:END -->';

describe('docs/CAPABILITY_MATRIX.md — auto-derived section drift guard', () => {
  it('matches LANGUAGE_SUPPORT_PROFILES byte-for-byte', async () => {
    const docContent = await fs.readFile(DOC_PATH, 'utf-8');
    const startIdx = docContent.indexOf(START_MARKER);
    const endIdx = docContent.indexOf(END_MARKER);
    expect(
      startIdx,
      'Auto-derived START marker missing from docs/CAPABILITY_MATRIX.md'
    ).toBeGreaterThanOrEqual(0);
    expect(
      endIdx,
      'Auto-derived END marker missing from docs/CAPABILITY_MATRIX.md'
    ).toBeGreaterThan(startIdx);

    // Extract the content between START and END markers, excluding
    // the marker lines themselves and any surrounding whitespace.
    const between = docContent.slice(startIdx + START_MARKER.length, endIdx);
    const actual = between.trim();
    const expected = renderLanguageScorecardMarkdown();
    if (actual !== expected) {
      const hint = [
        'CAPABILITY_MATRIX.md auto-derived section is out of sync with',
        'LANGUAGE_SUPPORT_PROFILES. Replace the fenced block with:',
        '',
        '<!-- AUTO-DERIVED:LANGUAGE_SUPPORT_PROFILES:START -->',
        expected,
        '<!-- AUTO-DERIVED:LANGUAGE_SUPPORT_PROFILES:END -->',
      ].join('\n');
      expect(actual, hint).toBe(expected);
    } else {
      expect(actual).toBe(expected);
    }
  });
});
