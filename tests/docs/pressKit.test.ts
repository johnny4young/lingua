 /**
 * RL-064 press kit guard — the launch assets live in `docs/press-kit/`
 * and must (a) exist, (b) ship en + es variants where a file is
 * customer-facing, (c) carry the honesty disclaimers the press-kit
 * README enforces. This test keeps a future overhaul from silently
 * dropping localized copy or reintroducing an "MIT" / "open-source"
 * claim.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const KIT_DIR = resolve(__dirname, '../../docs/press-kit');

const EXPECTED_FILES = ['README.md', 'boilerplate.md', 'pricing-one-pager.md', 'launch-copy.md', 'founder-bio.md'];

const BILINGUAL_FILES = ['boilerplate.md', 'pricing-one-pager.md', 'founder-bio.md'];

describe('docs/press-kit (RL-064)', () => {
  it('ships every canonical launch-asset file', () => {
    for (const filename of EXPECTED_FILES) {
      const path = resolve(KIT_DIR, filename);
      expect(existsSync(path)).toBe(true);
    }
  });

  it('customer-facing files have both English and Spanish sections', () => {
    for (const filename of BILINGUAL_FILES) {
      const content = readFileSync(resolve(KIT_DIR, filename), 'utf-8');
      expect(content).toContain('## English');
      expect(content).toContain('## Español');
    }
  });

  it('never claims the product is MIT or open source in press copy', () => {
    for (const filename of EXPECTED_FILES) {
      const content = readFileSync(resolve(KIT_DIR, filename), 'utf-8');
      expect(content).not.toMatch(/MIT.?licens/i);
      // "open-source" in press copy is the specific claim we forbid; we
      // still allow mentions like "open-source community" in a
      // hypothetical quote by asserting on the exact misclaim.
      expect(content).not.toMatch(/Lingua is open[-\s]?source/i);
    }
  });

  it('Show HN, Product Hunt, and subreddit sections all exist in launch-copy', () => {
    const copy = readFileSync(resolve(KIT_DIR, 'launch-copy.md'), 'utf-8');
    for (const section of ['## Show HN', '## Product Hunt', '## r/golang', '## r/rust', '## r/Python']) {
      expect(copy).toContain(section);
    }
  });

  it('pricing-one-pager names the five tiers + verified prices + in-app education flow (2026-05-05 model)', () => {
    const pricing = readFileSync(resolve(KIT_DIR, 'pricing-one-pager.md'), 'utf-8');
    // The five public tiers shipped on linguacode.dev as of 2026-05-05.
    // Legacy "Monthly" naming is gone — the monthly tier is now named
    // simply "Pro" and the one-time tier is "Pro Lifetime".
    for (const tier of ['Free', 'Pro', 'Pro Lifetime', 'Team', 'Education']) {
      expect(pricing).toContain(tier);
    }
    // Verified prices live on the site; the press kit must not drift.
    expect(pricing).toContain('$5');
    expect(pricing).toContain('$59');
    expect(pricing).toContain('$3');
    // Spanish mirror — Education translates to Educativa. Tier names
    // Pro / Pro Lifetime / Team stay in English by design (they're
    // product names, not common-noun copy).
    expect(pricing).toContain('Educativa');
    // Education flow is in-app only — no `linguacode.dev/education`
    // landing page is coming. Reject the legacy phrasing.
    expect(pricing).not.toMatch(/linguacode\.dev\/education/u);
    // Legacy "Monthly" / "Mensual" tier names must not survive the
    // rewrite as table-row tier identifiers.
    expect(pricing).not.toMatch(/^\|\s*Monthly\s*\|/mu);
    expect(pricing).not.toMatch(/^\|\s*Mensual\s*\|/mu);
  });

  it('does not describe ungated utilities or shortcut/theme customization as Pro-only yet', () => {
    const pricing = readFileSync(resolve(KIT_DIR, 'pricing-one-pager.md'), 'utf-8');
    const launchCopy = readFileSync(resolve(KIT_DIR, 'launch-copy.md'), 'utf-8');

    expect(pricing).not.toMatch(/Pro.*all developer utilities/isu);
    expect(pricing).not.toMatch(/Pro.*shortcut editor/isu);
    expect(pricing).not.toMatch(/Pro.*theme preset/isu);
    expect(launchCopy).not.toMatch(/Pro unlocks.*all utilities/isu);
  });
});
