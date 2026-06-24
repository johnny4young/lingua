/**
 * RL-095 Slice 1 — guard `docs/CAPABILITY_MATRIX.md` against drift.
 *
 * The doc carries auto-derived fenced sections between
 * `AUTO-DERIVED:LANGUAGE_SUPPORT_PROFILES[:PLATFORM]` markers. This
 * test reads the doc, locates each fence, regenerates the expected
 * content from `LANGUAGE_SUPPORT_PROFILES`, and asserts byte
 * equality. On failure the test output includes the expected block
 * so the human can copy-paste-fix.
 *
 * Slice 2 fold A — the doc now carries THREE blocks: the default
 * cross-platform table plus per-platform `:WEB` / `:DESKTOP` tables
 * resolved via `resolveCapabilityStatus`. The same
 * `renderLanguageScorecardMarkdown(profiles, platform)` helper is
 * consumed by the palette command (fold F / Slice 2 fold A), so a
 * passing test means the clipboard payload matches the doc verbatim
 * for whichever platform the user has selected.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  renderLanguageScorecardMarkdown,
  type ScorecardPlatform,
} from '../../src/shared/languageSupport';

const DOC_PATH = path.resolve(process.cwd(), 'docs/CAPABILITY_MATRIX.md');

/**
 * One auto-derived block per scorecard platform. `all` keeps the
 * original unsuffixed marker (no doc churn for the default table);
 * `web` / `desktop` use suffixed markers.
 */
const BLOCKS: { platform: ScorecardPlatform; marker: string }[] = [
  { platform: 'all', marker: 'AUTO-DERIVED:LANGUAGE_SUPPORT_PROFILES' },
  { platform: 'web', marker: 'AUTO-DERIVED:LANGUAGE_SUPPORT_PROFILES:WEB' },
  {
    platform: 'desktop',
    marker: 'AUTO-DERIVED:LANGUAGE_SUPPORT_PROFILES:DESKTOP',
  },
];

describe('docs/CAPABILITY_MATRIX.md — auto-derived section drift guard', () => {
  it.each(BLOCKS)(
    'matches LANGUAGE_SUPPORT_PROFILES byte-for-byte ($platform)',
    async ({ platform, marker }) => {
      const startMarker = `<!-- ${marker}:START -->`;
      const endMarker = `<!-- ${marker}:END -->`;
      const docContent = await fs.readFile(DOC_PATH, 'utf-8');
      const startIdx = docContent.indexOf(startMarker);
      const endIdx = docContent.indexOf(endMarker);
      expect(
        startIdx,
        `${startMarker} missing from docs/CAPABILITY_MATRIX.md`
      ).toBeGreaterThanOrEqual(0);
      expect(
        endIdx,
        `${endMarker} missing from docs/CAPABILITY_MATRIX.md`
      ).toBeGreaterThan(startIdx);

      // Extract the content between START and END markers, excluding
      // the marker lines themselves and any surrounding whitespace.
      const between = docContent.slice(startIdx + startMarker.length, endIdx);
      const actual = between.trim();
      const expected = renderLanguageScorecardMarkdown(undefined, platform);
      if (actual !== expected) {
        const hint = [
          `CAPABILITY_MATRIX.md auto-derived section (${platform}) is out of`,
          'sync with LANGUAGE_SUPPORT_PROFILES. Replace the fenced block with:',
          '',
          startMarker,
          expected,
          endMarker,
        ].join('\n');
        expect(actual, hint).toBe(expected);
      } else {
        expect(actual).toBe(expected);
      }
    }
  );
});
