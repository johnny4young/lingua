import { describe, expect, it } from 'vitest';
import { answerColumnBand, jsStatementEndLine, statementEndLine, type JsLineDepth } from '@/components/Editor/answerColumnGeometry';
import { walkTopLevelLines } from '@/utils/magicComments/jsLexer';

const endOf = (source: string, line: number, language = 'javascript') => {
  const lines = source.split('\n');
  return statementEndLine(at => lines[at - 1] ?? '', line, lines.length, language);
};

describe('answerColumnBand', () => {
  it('keeps the column at 42 % of the content and turns narrow when code has under 360 px', () => {
    expect(answerColumnBand({ contentWidth: 1200 })).toEqual({ start: 674, width: 504, narrow: false });
    expect(answerColumnBand({ contentWidth: 714 })).toMatchObject({ start: 392, narrow: false });
    expect(answerColumnBand({ contentWidth: 600 })).toMatchObject({ start: 298, narrow: true });
  });
});

describe('statementEndLine', () => {
  it('ends a single-line statement on itself', () => {
    expect(endOf('const a = [1, 2]\nnext', 1)).toBe(1);
  });

  it('follows open brackets to the line that closes them', () => {
    expect(endOf('console.table([\n  { a: 1 },\n  { a: 2 },\n])\nnext', 1)).toBe(4);
  });

  it('ignores brackets inside strings and comments', () => {
    expect(endOf('log("(" + x) // (\nnext', 1)).toBe(1);
    expect(endOf('report = [  # [\n  "]",\n]\nnext', 1, 'python')).toBe(3);
    expect(endOf('call(/* ( */ a,\n  b)\nnext', 1)).toBe(2);
  });

  it('carries a template literal and a Python triple-quoted string across lines', () => {
    expect(endOf('log(`a\n(b\n`)\nnext', 1)).toBe(3);
    expect(endOf('text = f("""\n(\n""")\nnext', 1, 'python')).toBe(3);
  });

  it('gives up on a statement that never closes within the cap', () => {
    expect(endOf(`run(\n${'  x,\n'.repeat(80)}`, 1)).toBe(1);
  });
});

describe('jsStatementEndLine', () => {
  const depths = (source: string) => {
    const lines: JsLineDepth[] = [];
    walkTopLevelLines(source, info => lines.push(info));
    return lines;
  };

  it('reads the span from the shared lexer, regex literals included', () => {
    const lines = depths('log([\n  /[(]/.test(a),\n])\nnext');
    expect(jsStatementEndLine(lines, 1)).toBe(3);
    expect(jsStatementEndLine(lines, 4)).toBe(4);
  });

  it('ends a line inside a block on itself', () => {
    expect(jsStatementEndLine(depths('for (const x of xs) {\n  console.log(x)\n}'), 2)).toBe(2);
  });
});
