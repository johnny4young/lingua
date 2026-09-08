/**
 * The per-line side-tables JS, TS and Python runners build before a run.
 *
 * These maps used to be assembled by three copies of the same loop, one
 * per runner. The behaviour they encode is load-bearing: a wrong `kind`
 * mislabels an inline result in the editor gutter, and a lost directive
 * silently downgrades a `//=> table` back to a stringified value. The
 * cases below pin the exact semantics the three copies shared, including
 * the arrow/watch-over-auto-log precedence.
 */

import { describe, expect, it } from 'vitest';
import { buildMagicLineMaps, markAutoLogLines } from '@/runners/magicLineMap';
import type { MagicCommentKind, MagicCommentLine } from '@/utils/magicComments';

function entry(
  line: number,
  kind: MagicCommentKind,
  directive?: MagicCommentLine['directive']
): MagicCommentLine {
  const base: MagicCommentLine = { line, expression: 'x', kind, preserve: '' };
  return directive ? { ...base, directive } : base;
}

describe('buildMagicLineMaps', () => {
  it('returns empty tables for no entries', () => {
    expect(buildMagicLineMaps([])).toEqual({ kindByLine: {}, directiveByLine: {} });
  });

  it('maps each line to its variant', () => {
    const { kindByLine } = buildMagicLineMaps([
      entry(2, 'arrow'),
      entry(7, 'watch'),
    ]);

    expect(kindByLine).toEqual({ 2: 'arrow', 7: 'watch' });
  });

  it('leaves the directive table empty when no entry carries one', () => {
    const { directiveByLine } = buildMagicLineMaps([entry(1, 'arrow')]);

    expect(directiveByLine).toEqual({});
  });

  it('records a directive only for the lines that declare one', () => {
    const { kindByLine, directiveByLine } = buildMagicLineMaps([
      entry(3, 'arrow', 'table'),
      entry(4, 'arrow'),
      entry(9, 'arrow', 'chart'),
    ]);

    expect(kindByLine).toEqual({ 3: 'arrow', 4: 'arrow', 9: 'arrow' });
    expect(directiveByLine).toEqual({ 3: 'table', 9: 'chart' });
  });

  it('lets a later entry on the same line win', () => {
    const { kindByLine, directiveByLine } = buildMagicLineMaps([
      entry(5, 'arrow', 'table'),
      entry(5, 'watch'),
    ]);

    expect(kindByLine[5]).toBe('watch');
    // The directive survives: the original loop only ever wrote to the
    // directive table, it never cleared a previous entry.
    expect(directiveByLine[5]).toBe('table');
  });

  it('does not inherit Object.prototype keys', () => {
    const { kindByLine } = buildMagicLineMaps([entry(1, 'arrow')]);

    expect(Object.keys(kindByLine)).toEqual(['1']);
    expect(kindByLine[2]).toBeUndefined();
  });
});

describe('markAutoLogLines', () => {
  it('adds auto-log lines to an empty map', () => {
    const kindByLine: Record<number, MagicCommentKind> = {};

    markAutoLogLines(kindByLine, [1, 4]);

    expect(kindByLine).toEqual({ 1: 'autoLog', 4: 'autoLog' });
  });

  it('never overwrites a line an arrow or watch already claimed', () => {
    const { kindByLine } = buildMagicLineMaps([
      entry(2, 'arrow'),
      entry(3, 'watch'),
    ]);

    markAutoLogLines(kindByLine, [2, 3, 5]);

    expect(kindByLine).toEqual({ 2: 'arrow', 3: 'watch', 5: 'autoLog' });
  });

  it('is a no-op for an empty line list', () => {
    const kindByLine: Record<number, MagicCommentKind> = { 1: 'arrow' };

    markAutoLogLines(kindByLine, []);

    expect(kindByLine).toEqual({ 1: 'arrow' });
  });

  it('tolerates a repeated line without changing the result', () => {
    const kindByLine: Record<number, MagicCommentKind> = {};

    markAutoLogLines(kindByLine, [6, 6]);

    expect(kindByLine).toEqual({ 6: 'autoLog' });
  });
});
