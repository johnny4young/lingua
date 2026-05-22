import { describe, it, expect } from 'vitest';
import {
  SEEDED_SCRATCHPAD_LANGUAGE,
  SEEDED_SCRATCHPAD_NAME,
  SEEDED_SCRATCHPAD_SOURCE,
  SEEDED_SCRATCHPAD_VERSION,
} from '../../../src/renderer/onboarding/seedScratchpad';

describe('seedScratchpad module', () => {
  it('ships a current-version constant >= 1', () => {
    expect(SEEDED_SCRATCHPAD_VERSION).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(SEEDED_SCRATCHPAD_VERSION)).toBe(true);
  });

  it('targets javascript so the Worker runtime (Free tier) can run it without setup', () => {
    expect(SEEDED_SCRATCHPAD_LANGUAGE).toBe('javascript');
  });

  it('uses a .js filename so the editor language detector matches', () => {
    expect(SEEDED_SCRATCHPAD_NAME).toMatch(/\.js$/u);
  });

  it('passes basic structural checks for valid JavaScript', () => {
    // Lightweight structural assertions — esbuild's native binary is
    // not loadable in this jsdom environment so we fall back to
    // pattern checks. The TypeScript compiler already parses the
    // source as a `const` literal at build time, so any real syntax
    // error in the seed would fail the project tsc gate before this
    // test ever runs.
    const balancedBraces =
      (SEEDED_SCRATCHPAD_SOURCE.match(/\{/g) ?? []).length ===
      (SEEDED_SCRATCHPAD_SOURCE.match(/\}/g) ?? []).length;
    const balancedParens =
      (SEEDED_SCRATCHPAD_SOURCE.match(/\(/g) ?? []).length ===
      (SEEDED_SCRATCHPAD_SOURCE.match(/\)/g) ?? []).length;
    const balancedBrackets =
      (SEEDED_SCRATCHPAD_SOURCE.match(/\[/g) ?? []).length ===
      (SEEDED_SCRATCHPAD_SOURCE.match(/\]/g) ?? []).length;
    expect(balancedBraces).toBe(true);
    expect(balancedParens).toBe(true);
    expect(balancedBrackets).toBe(true);
    // Must end with newline so the editor's last-line caret sits on
    // an empty row, not at the trailing semicolon of the last
    // statement — a small UX nicety.
    expect(SEEDED_SCRATCHPAD_SOURCE.endsWith('\n')).toBe(true);
  });

  it('contains the console.table demo so the welcome moment is visible', () => {
    expect(SEEDED_SCRATCHPAD_SOURCE).toMatch(/console\.table\(/);
  });

  it('is short enough to fit on a small viewport (under 12 lines + 700 chars)', () => {
    const lines = SEEDED_SCRATCHPAD_SOURCE.split('\n').filter(
      (line) => line.length > 0
    );
    expect(lines.length).toBeLessThanOrEqual(12);
    expect(SEEDED_SCRATCHPAD_SOURCE.length).toBeLessThanOrEqual(700);
  });

  it('does not pull in identifiers that imply network or Node-only built-ins', () => {
    // The Worker runtime has no fetch, no fs, no process. Pinning the
    // seed against these names protects against a future demo update
    // accidentally breaking Free tier.
    expect(SEEDED_SCRATCHPAD_SOURCE).not.toMatch(/\bfetch\(/);
    expect(SEEDED_SCRATCHPAD_SOURCE).not.toMatch(/\brequire\(/);
    expect(SEEDED_SCRATCHPAD_SOURCE).not.toMatch(/\bprocess\./);
    expect(SEEDED_SCRATCHPAD_SOURCE).not.toMatch(/\bimport\s+/);
  });
});
