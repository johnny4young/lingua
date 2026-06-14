import { describe, expect, it } from 'vitest';
import {
  buildTryCatchWrap,
  countCustomLintIssues,
  findLintIssues,
  suggestSemicolonFix,
} from '@/lint/customLintRules';

/**
 * RL-108 — locks the pure custom lint rules. The strict-equality scanner must
 * fire on real loose operators and NEVER on `===`/`!==`, or on `==`/`!=` inside
 * strings or comments (false-positive guards are the whole point of a custom
 * rule shipping squiggles).
 */
const MSG = { strictEquality: 'use ===' };

describe('findLintIssues — strict-equality', () => {
  it('flags == and != and fixes to the strict form', () => {
    const issues = findLintIssues('if (a == b && c != d) {}', 'typescript', MSG);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ ruleId: 'strict-equality', fixText: '===' });
    expect(issues[1]).toMatchObject({ ruleId: 'strict-equality', fixText: '!==' });
    // Range points at the operator (1-based).
    expect(issues[0]!.startColumn).toBe('if (a '.length + 1);
  });

  it('does NOT flag === or !==', () => {
    expect(findLintIssues('if (a === b || c !== d) {}', 'javascript', MSG)).toEqual([]);
  });

  it('does NOT flag == inside a string or comment', () => {
    expect(findLintIssues('const s = "a == b";', 'typescript', MSG)).toEqual([]);
    expect(findLintIssues("const s = 'x != y';", 'typescript', MSG)).toEqual([]);
    expect(findLintIssues('// a == b\nconst x = 1;', 'typescript', MSG)).toEqual([]);
    expect(findLintIssues('/* a != b */\nconst x = 1;', 'typescript', MSG)).toEqual([]);
    expect(findLintIssues('const t = `a == ${b}`;', 'typescript', MSG)).toEqual([]);
  });

  it('does NOT flag <=, >=, or => (fat arrow)', () => {
    expect(findLintIssues('const f = (x) => x >= 1 && x <= 9;', 'typescript', MSG)).toEqual([]);
  });

  it('handles escaped quotes inside strings without desyncing', () => {
    expect(findLintIssues('const s = "she said \\"a == b\\""; const ok = c === d;', 'typescript', MSG)).toEqual([]);
  });

  it('reports correct line numbers across multiple lines', () => {
    const issues = findLintIssues('const a = 1;\nif (a == 2) {}', 'javascript', MSG);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.startLineNumber).toBe(2);
  });

  it('returns nothing for non-JS/TS languages or empty input', () => {
    expect(findLintIssues('a == b', 'python', MSG)).toEqual([]);
    expect(findLintIssues('', 'typescript', MSG)).toEqual([]);
  });
});

describe('suggestSemicolonFix', () => {
  it('offers a semicolon for a statement line that lacks one', () => {
    expect(suggestSemicolonFix('const x = 1')).toEqual({ column: 'const x = 1'.length + 1, fixText: ';' });
    expect(suggestSemicolonFix('doThing()')).toEqual({ column: 'doThing()'.length + 1, fixText: ';' });
  });

  it('does not offer one when the line already ends in punctuation that forbids it', () => {
    expect(suggestSemicolonFix('const x = 1;')).toBeNull();
    expect(suggestSemicolonFix('if (a) {')).toBeNull();
    expect(suggestSemicolonFix('const obj = {')).toBeNull();
    expect(suggestSemicolonFix('  arr.map((x) =>')).toBeNull();
    expect(suggestSemicolonFix('const a = b +')).toBeNull();
    expect(suggestSemicolonFix('foo,')).toBeNull();
    expect(suggestSemicolonFix('}')).toBeNull();
    expect(suggestSemicolonFix('   ')).toBeNull();
  });

  it('ignores a trailing line comment when deciding', () => {
    expect(suggestSemicolonFix('const x = 1 // note')).toEqual({ column: 'const x = 1'.length + 1, fixText: ';' });
  });
});

describe('countCustomLintIssues', () => {
  it('counts the custom lint issues in a JS/TS buffer', () => {
    expect(countCustomLintIssues('if (a == b && c != d) {}', 'typescript')).toBe(2);
    expect(countCustomLintIssues('if (a === b) {}', 'javascript')).toBe(0);
  });

  it('returns 0 for non-JS/TS languages and empty buffers', () => {
    expect(countCustomLintIssues('a == b', 'python')).toBe(0);
    expect(countCustomLintIssues('', 'typescript')).toBe(0);
  });
});

describe('buildTryCatchWrap', () => {
  it('wraps the selection and preserves base indentation', () => {
    const wrapped = buildTryCatchWrap('doRisky()', '  ');
    expect(wrapped).toBe(
      '  try {\n    doRisky()\n  } catch (error) {\n    console.error(error);\n  }'
    );
  });

  it('does not double-apply the base indentation from full Monaco lines', () => {
    const wrapped = buildTryCatchWrap('  doRisky()', '  ');
    expect(wrapped).toBe(
      '  try {\n    doRisky()\n  } catch (error) {\n    console.error(error);\n  }'
    );
  });

  it('indents every non-empty line of a multi-line selection', () => {
    const wrapped = buildTryCatchWrap('a()\n\nb()', '');
    expect(wrapped).toBe('try {\n  a()\n\n  b()\n} catch (error) {\n  console.error(error);\n}');
  });
});
