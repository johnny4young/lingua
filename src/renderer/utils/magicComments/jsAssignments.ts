/**
 * Scratchpad assignment answers for JS / TS: top-level `const` / `let` /
 * `var` declarations of one identifier, and plain identifier assignments
 * spanning several lines, answer with the bound value once the statement
 * has run. Single-line assignments already answer as bare expressions.
 */

import {
  EMPTY_MAGIC_LINES,
  endsTopLevelStatement,
  startsNewTopLevelStatement,
  trimLine,
  walkLines,
  type TopLevelLineInfo,
} from './jsLexer';

/** A top-level binding that answers on its first line after its statement runs. */
export interface JSAssignmentAnswer {
  /** 1-based line the statement starts on, where the answer shows. */
  line: number;
  /** 1-based line the statement ends on; the capture goes after it. */
  endLine: number;
  /** Where the code on `endLine` ends, before any trailing `//` comment. */
  endColumn: number;
  /** Identifier read back after the statement. */
  name: string;
}

const DECLARATION = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/;
const ASSIGNMENT = /^([A-Za-z_$][\w$]*)\s*(?:\*\*|>>>|<<|>>|&&|\|\||\?\?|[-+*/%&|^])?=(?![=>])/;
const NON_NAMES = new Set(['this', 'super', 'null', 'true', 'false', 'undefined', 'await', 'yield']);
const FUNCTION_VALUE = /(?:async|function|class)\b|<|[A-Za-z_$][\w$]*\s*=>/y;
const ARROW_AFTER_PARAMS = /\s*(?:=>|:)/y;
// A braceless `if` / loop / `else` / `do` header: the capture would run outside its body.
const CONTROL_HEADER = /^(?:(?:\}\s*)?else\s+if|if|for|while|with)\b.*\)$|^(?:\}\s*)?else$|^do$/;

/** First index from `from` that is not whitespace or `;`, or the text's length. */
function skipBlank(text: string, from: number): number {
  let i = from;
  for (; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code !== 59 && code > 32 && code !== 160 && code !== 0xfeff) break;
  }
  return i;
}

/**
 * Where the statement's value starts: at `from` when the `=` is already
 * consumed, else after the first top-level `=` (past a TS annotation).
 * -1 when it holds no single value: several declarators or statements.
 */
function valueStart(text: string, from: number, afterEquals: boolean): number {
  let depth = 0;
  let angles = 0;
  let start = afterEquals ? from : -1;
  for (let i = from; i < text.length; i++) {
    const c = text[i]!;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth !== 0) continue;
    else if (start < 0) {
      if (c === '<') angles++;
      else if (c === '>' && text[i - 1] !== '=') angles--;
      else if (c === '=' && text[i + 1] !== '=' && text[i + 1] !== '>') {
        start = i + 1;
        angles = 0;
      } else if (c === ';' || (c === ',' && angles <= 0)) return -1;
    } else if (c === '<') angles++;
    else if (c === '>' && text[i - 1] !== '=') angles--;
    else if ((c === ',' && angles <= 0) || (c === ';' && skipBlank(text, i + 1) < text.length)) return -1;
  }
  return start;
}

/** Index of the `)` closing the `(` at `open`, or -1. */
export function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/** The value at `start` is empty, a function or a class, so it has no answer worth showing. */
function hasNoAnswer(text: string, start: number): boolean {
  const head = skipBlank(text, start);
  if (head >= text.length) return true;
  FUNCTION_VALUE.lastIndex = head;
  if (FUNCTION_VALUE.test(text)) return true;
  if (text[head] !== '(') return false;
  const close = closingParen(text, head);
  ARROW_AFTER_PARAMS.lastIndex = close + 1;
  return close > 0 && ARROW_AFTER_PARAMS.test(text);
}

/**
 * Bindings in `code` that answer with their value. Skips destructuring,
 * declarations without a value or with several declarators, function and
 * class values, generated `__` names and statements touching a line in
 * `magicLines` (`//=>` and `@watch` keep precedence).
 */
export function detectJSAssignmentAnswers(
  code: string,
  magicLines: ReadonlySet<number> = EMPTY_MAGIC_LINES,
  lines: readonly TopLevelLineInfo[] = walkLines(code)
): JSAssignmentAnswer[] {
  const out: JSAssignmentAnswer[] = [];
  let previousEnded = true;
  let previousText = '';
  for (let index = 0; index < lines.length; index++) {
    const info = lines[index]!;
    if (info.depthAtStart !== 0 || info.openTokenAtStart) {
      previousEnded = endsTopLevelStatement(info);
      previousText = trimLine(info.stripped) || previousText;
      continue;
    }
    const text = trimLine(info.stripped);
    if (text.length === 0) continue;
    const startsStatement = previousEnded && !CONTROL_HEADER.test(previousText);
    previousEnded = endsTopLevelStatement(info);
    previousText = text;
    if (!startsStatement) continue;
    const declaration = DECLARATION.exec(text);
    const match = declaration ?? ASSIGNMENT.exec(text);
    const name = match?.[1];
    if (!match || !name || name.startsWith('__') || NON_NAMES.has(name)) continue;

    let end = index;
    while (end < lines.length && !endsTopLevelStatement(lines[end]!)) end++;
    if (end >= lines.length) break;
    const answer = bindingAnswer(lines, index, end, match[0].length, !declaration, magicLines);
    if (answer) out.push({ ...answer, name });
    // Lines inside the statement cannot start another one.
    index = end;
    previousEnded = true;
    previousText = trimLine(lines[end]!.stripped);
  }
  return out;
}

function bindingAnswer(
  lines: readonly TopLevelLineInfo[],
  index: number,
  end: number,
  matchLength: number,
  plainAssignment: boolean,
  magicLines: ReadonlySet<number>
): Omit<JSAssignmentAnswer, 'name'> | null {
  // A single-line plain assignment already answers as a bare expression.
  if (plainAssignment && end === index) return null;
  let next = end + 1;
  while (next < lines.length && trimLine(lines[next]!.stripped).length === 0) next++;
  if (next < lines.length && !startsNewTopLevelStatement(trimLine(lines[next]!.stripped))) return null;
  if (magicLines.size > 0) {
    for (let line = index + 1; line <= end + 1; line++) if (magicLines.has(line)) return null;
  }
  const first = lines[index]!.stripped;
  const statement = end === index ? first : lines.slice(index, end + 1).map((line) => line.stripped).join('\n');
  const offset = first.length - first.trimStart().length;
  const start = valueStart(statement, offset + matchLength, plainAssignment);
  if (start < 0 || hasNoAnswer(statement, start)) return null;
  // Comments are masked to spaces, so the trimmed mask ends where the code does.
  const last = lines[end]!;
  return { line: lines[index]!.lineNumber, endLine: last.lineNumber, endColumn: last.stripped.trimEnd().length };
}
