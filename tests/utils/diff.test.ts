import { describe, expect, it } from 'vitest';
import {
  computeDiff,
  diffChars,
  diffLines,
  diffWords,
  summarizeDiff,
  type DiffSegment,
} from '@/utils/diff';

function flatten(segments: readonly DiffSegment[]): string {
  return segments
    .map((segment) => `${segment.kind[0]}${segment.text}`)
    .join('|');
}

describe('diffLines', () => {
  it('returns one equal segment per line for identical inputs', () => {
    // Line mode preserves per-line segments so the summary reflects line
    // counts, not "runs of equal text".
    const result = diffLines('a\nb\nc', 'a\nb\nc');
    expect(result).toEqual([
      { kind: 'equal', text: 'a' },
      { kind: 'equal', text: 'b' },
      { kind: 'equal', text: 'c' },
    ]);
  });

  it('emits remove + add at the mutated line while framing equal context', () => {
    const result = diffLines('a\nb\nc', 'a\nB\nc');
    const summary = summarizeDiff(result);
    expect(summary.add).toBe(1);
    expect(summary.remove).toBe(1);
    expect(summary.equal).toBe(2);
    expect(flatten(result)).toBe('ea|rb|aB|ec');
  });

  it('returns one add-segment per line for empty-vs-non-empty input', () => {
    const result = diffLines('', 'new\nline');
    expect(result).toEqual([
      { kind: 'add', text: 'new' },
      { kind: 'add', text: 'line' },
    ]);
  });

  it('returns one remove-segment per line when the right side is empty', () => {
    const result = diffLines('lost\nlines', '');
    expect(result).toEqual([
      { kind: 'remove', text: 'lost' },
      { kind: 'remove', text: 'lines' },
    ]);
  });

  it('returns an empty array when both sides are empty', () => {
    expect(diffLines('', '')).toEqual([]);
  });
});

describe('diffWords', () => {
  it('tokenizes whitespace as its own segment so spacing survives round-trip', () => {
    const result = diffWords('the quick fox', 'the slow fox');
    // Whitespace tokens before/after the mutated word stay in `equal` runs
    // and get merged with their neighboring equal text.
    expect(flatten(result)).toBe('ethe |rquick|aslow|e fox');
    // Every original character reappears once on at least one side.
    expect(result.map((s) => s.text).join('')).toBe('the quickslow fox');
  });

  it('recognizes a single-word insertion at the end', () => {
    const result = diffWords('lingua is fast', 'lingua is fast and safe');
    const summary = summarizeDiff(result);
    expect(summary.add).toBeGreaterThan(0);
    expect(summary.remove).toBe(0);
    // The trailing addition should contain " and safe".
    const joined = result.map((segment) => segment.text).join('');
    expect(joined).toBe('lingua is fast and safe');
  });

  it('merges adjacent same-kind tokens into single runs', () => {
    const result = diffWords('abc def', 'xyz def');
    // The word boundary between "abc" and "xyz" is clean: remove run + add run.
    expect(result.find((segment) => segment.kind === 'remove')?.text).toBe('abc');
    expect(result.find((segment) => segment.kind === 'add')?.text).toBe('xyz');
  });
});

describe('diffChars', () => {
  it('minimal single-char edit returns exact 4 segments', () => {
    const result = diffChars('abc', 'axc');
    expect(flatten(result)).toBe('ea|rb|ax|ec');
  });

  it('keeps emoji graphemes intact', () => {
    // Emoji with skin tone modifier — Array.from splits by code point, so
    // `👋🏽` is two entries. Diff should still work but treat them atomically.
    const result = diffChars('hi 👋', 'hi 👋🏽');
    const summary = summarizeDiff(result);
    expect(summary.add).toBe(1);
    expect(summary.remove).toBe(0);
  });

  it('identical inputs collapse to one equal segment regardless of length', () => {
    const text = 'a'.repeat(500);
    const result = diffChars(text, text);
    expect(result).toEqual([{ kind: 'equal', text }]);
  });
});

describe('computeDiff dispatch', () => {
  it('routes to the right tokenizer by granularity', () => {
    expect(computeDiff('ab', 'ab', 'line')).toEqual([{ kind: 'equal', text: 'ab' }]);
    expect(computeDiff('ab', 'ab', 'word')).toEqual([{ kind: 'equal', text: 'ab' }]);
    expect(computeDiff('ab', 'ab', 'character')).toEqual([{ kind: 'equal', text: 'ab' }]);
  });

  it('word-level catches a typo in the middle of a sentence', () => {
    const result = computeDiff(
      'the quick brown fox',
      'the slow brown fox',
      'word'
    );
    const removes = result.filter((segment) => segment.kind === 'remove').map((s) => s.text);
    const adds = result.filter((segment) => segment.kind === 'add').map((s) => s.text);
    expect(removes).toContain('quick');
    expect(adds).toContain('slow');
  });

  it('clamps inputs that exceed the safety threshold without throwing', () => {
    const huge = 'x'.repeat(50_000);
    const result = computeDiff(huge, `${huge}y`, 'character');
    // The helper clamps to 40_000 chars per side, so the left/right both
    // become identical prefixes of length 40_000. No throw, a single
    // equal segment is acceptable.
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('summarizeDiff', () => {
  it('counts segments by kind', () => {
    const segments: DiffSegment[] = [
      { kind: 'equal', text: 'a' },
      { kind: 'add', text: 'b' },
      { kind: 'remove', text: 'c' },
      { kind: 'equal', text: 'd' },
    ];
    expect(summarizeDiff(segments)).toEqual({ add: 1, remove: 1, equal: 2 });
  });

  it('returns zero counts for empty input', () => {
    expect(summarizeDiff([])).toEqual({ add: 0, remove: 0, equal: 0 });
  });
});
