import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { describeRegexToken, explainRegex } from '../../src/renderer/utils/regexExplain';

const t = (key: string, options?: Record<string, unknown>) => i18next.t(key, options) as string;
const gloss = (pattern: string, flags = '') =>
  explainRegex(pattern, flags)?.map(token => [token.source, describeRegexToken(token, t)]);

beforeAll(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
});

describe('regex explainer', () => {
  it('glosses the board example token by token', () => {
    expect(gloss('(\\w+)@(\\w+\\.\\w+)')).toEqual([
      ['(\\w+)', 'word char, one or more → group 1'],
      ['@', 'literal'],
      ['(\\w+\\.\\w+)', 'word char, one or more, literal ., word char, one or more → group 2'],
    ]);
  });

  it('covers anchors, classes, quantifiers and alternation', () => {
    expect(gloss('^[a-z]{2,4}?|[^0-9]*$')).toEqual([
      ['^', 'start of input'],
      ['[a-z]{2,4}?', 'one of [a-z], 2 to 4 (as few as possible)'],
      ['|', 'or'],
      ['[^0-9]*', 'none of [0-9], zero or more'],
      ['$', 'end of input'],
    ]);
    expect(gloss('^x$', 'm')?.map(([, meaning]) => meaning)).toEqual([
      'start of line',
      'literal',
      'end of line',
    ]);
  });

  it('names lookarounds, named groups, backreferences and properties', () => {
    expect(gloss('(?<year>\\d{4})(?=-)\\k<year>(?<!x)\\p{L}')).toEqual([
      ['(?<year>\\d{4})', 'digit, exactly 4 → group year'],
      ['(?=-)', 'followed by literal'],
      ['\\k<year>', 'same text as group year'],
      ['(?<!x)', 'not preceded by literal'],
      ['\\p{L}', 'Unicode L'],
    ]);
  });

  it('merges plain characters and keeps a quantified one apart', () => {
    expect(gloss('abc+')).toEqual([
      ['ab', 'literal'],
      ['c+', 'literal, one or more'],
    ]);
  });

  it('returns null for a pattern the engine rejects', () => {
    expect(explainRegex('(unclosed')).toBeNull();
  });
});
