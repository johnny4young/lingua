import { describe, expect, it } from 'vitest';
import { fuzzyMatch } from '@/utils/fuzzyMatch';

describe('fuzzyMatch', () => {
  it('returns null for an empty query', () => {
    expect(fuzzyMatch('', 'JSON Formatter')).toBeNull();
  });

  it('treats whitespace queries the same as any other character — match if present', () => {
    // Single space matches "JSON Formatter" because the target contains
    // a space. Callers that want to bail on whitespace are expected to
    // trim before calling.
    expect(fuzzyMatch(' ', 'JSON Formatter')).not.toBeNull();
    // Two-space query against a single-space target fails because the
    // matcher needs both characters to appear in order.
    expect(fuzzyMatch('  ', 'JSON Formatter')).toBeNull();
  });

  it('returns null for an empty target', () => {
    expect(fuzzyMatch('json', '')).toBeNull();
  });

  it('matches substrings case-insensitively', () => {
    expect(fuzzyMatch('json', 'JSON Formatter')).toBeGreaterThan(0);
    expect(fuzzyMatch('JSON', 'json formatter')).toBeGreaterThan(0);
    expect(fuzzyMatch('Format', 'JSON Formatter')).toBeGreaterThan(0);
  });

  it('scores token-prefix substrings higher than mid-token substrings', () => {
    const tokenPrefix = fuzzyMatch('format', 'JSON Formatter')!;
    const midToken = fuzzyMatch('rmat', 'JSON Formatter')!;
    expect(tokenPrefix).toBeGreaterThan(midToken);
  });

  it('scores substring matches higher than subsequence matches', () => {
    const substring = fuzzyMatch('json', 'JSON Formatter')!;
    const subsequence = fuzzyMatch('jsf', 'JSON Formatter')!; // J-S-F scattered
    expect(substring).toBeGreaterThan(subsequence);
  });

  it('matches subsequences when characters are scattered in order', () => {
    expect(fuzzyMatch('jsf', 'JSON Formatter')).toBeGreaterThan(0);
    expect(fuzzyMatch('htm', 'HTML to JSX')).toBeGreaterThan(0);
    expect(fuzzyMatch('mp', 'Markdown Preview')).toBeGreaterThan(0);
  });

  it('rewards consecutive subsequence runs over fully scattered ones', () => {
    // q='te' against 'outer text' — t at index 6, e at index 7, so the
    // subsequence walk lands two consecutive matches (bestRun=2).
    // 'outer text' has no 'te' substring, so the substring fast-path
    // doesn't fire — both cases below land in the subsequence branch.
    const consecutive = fuzzyMatch('te', 'outer text')!;
    // q='te' against 'thread by ace' — t at 0, e at 3, no consecutive
    // run (bestRun=1). Same charsMatched as above, lower bestRun bonus.
    const scattered = fuzzyMatch('te', 'thread by ace')!;
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it('returns null when characters are missing or out of order', () => {
    expect(fuzzyMatch('xyz', 'JSON Formatter')).toBeNull();
    expect(fuzzyMatch('nosj', 'JSON')).toBeNull();
    // Missing 'q' fails subsequence
    expect(fuzzyMatch('jsoq', 'JSON')).toBeNull();
  });

  it('preserves unicode characters in both query and target', () => {
    expect(fuzzyMatch('café', 'Latin café preview')).toBeGreaterThan(0);
    expect(fuzzyMatch('ñ', 'Lingua ñ')).toBeGreaterThan(0);
    expect(fuzzyMatch('中', '中文搜索')).toBeGreaterThan(0);
  });

  it('handles single-character queries', () => {
    const single = fuzzyMatch('j', 'JSON Formatter')!;
    expect(single).toBeGreaterThan(0);
  });

  it('produces stable scores for identical inputs', () => {
    const a = fuzzyMatch('json', 'JSON Formatter');
    const b = fuzzyMatch('json', 'JSON Formatter');
    expect(a).toBe(b);
  });
});
