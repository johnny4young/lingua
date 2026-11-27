import type * as monacoTypes from 'monaco-editor';
import type { TopLevelLineInfo } from '../../utils/magicComments/jsLexer';

const RIGHT_PAD = 22;
/** Space either side of the leader, and its shortest length before an answer moves below. */
export const LEADER_MARGIN = 14;
export const MIN_LEADER = 26;
/** Below this much room for code beside the column, every answer moves under its line. */
const NARROW_CODE_ROOM = 360;
/** The longest statement an answer spans; a longer one answers beside its first line only. */
const MAX_STATEMENT_LINES = 50;

export interface AnswerColumnBand {
  start: number;
  width: number;
  /** Too little room for code beside the column: answers sit under their lines instead. */
  narrow: boolean;
}

/**
 * The answer column every editor answer lines up in: its start and width,
 * measured from the left edge of the visible content area.
 */
export function answerColumnBand(layout: Pick<monacoTypes.editor.EditorLayoutInfo, 'contentWidth'>): AnswerColumnBand {
  const width = Math.round(Math.min(680, Math.max(280, layout.contentWidth * 0.42)));
  const start = Math.max(0, layout.contentWidth - RIGHT_PAD - width);
  return { start, width, narrow: start < NARROW_CODE_ROOM };
}

/** Width an answer under its line gets when it starts `indent` pixels into the content area. */
export function belowAnswerWidth(layout: Pick<monacoTypes.editor.EditorLayoutInfo, 'contentWidth'>, indent: number): number {
  return Math.max(160, layout.contentWidth - RIGHT_PAD - indent);
}

/** Where a line's text ends in content coordinates, or null while Monaco has not rendered it. */
export function lineEnd(editor: monacoTypes.editor.IStandaloneCodeEditor, line: number): number | null {
  const model = editor.getModel();
  if (!model || line < 1 || line > model.getLineCount()) return null;
  const offset = editor.getOffsetForColumn(line, model.getLineMaxColumn(line));
  return offset >= 0 ? offset : null;
}

/** Where a line's code starts after its indentation, in content coordinates. */
export function lineIndent(editor: monacoTypes.editor.IStandaloneCodeEditor, line: number): number | null {
  const model = editor.getModel();
  if (!model || line < 1 || line > model.getLineCount()) return null;
  const offset = editor.getOffsetForColumn(line, Math.max(1, model.getLineFirstNonWhitespaceColumn(line)));
  return offset >= 0 ? offset : null;
}

/** What the shared JS line walker reports about a line's brackets. */
export type JsLineDepth = Pick<TopLevelLineInfo, 'depthAtStart' | 'depthAtEnd' | 'openTokenAtEnd'>;

/** The last line of the JS/TS statement that starts on `line`, from the shared lexer's per-line depths. */
export function jsStatementEndLine(lines: readonly JsLineDepth[], line: number): number {
  const base = lines[line - 1]?.depthAtStart ?? 0;
  const last = Math.min(lines.length, line + MAX_STATEMENT_LINES);
  for (let current = line; current <= last; current += 1) {
    const info = lines[current - 1]!;
    if (info.depthAtEnd <= base && !info.openTokenAtEnd) return current;
  }
  return line;
}

const HASH_COMMENT_LANGUAGES = new Set(['python', 'ruby', 'shell', 'r', 'elixir']);
const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);

/**
 * The last line of the statement that starts on `line` in a language without
 * the JS lexer: the line where the brackets it opens close again. Strings,
 * triple-quoted strings and comments are skipped. A line that
 * closes everything it opens, or a statement longer than the cap, ends on
 * itself.
 */
export function statementEndLine(
  lineAt: (line: number) => string,
  line: number,
  lineCount: number,
  language: string | undefined
): number {
  const hashComments = language !== undefined && HASH_COMMENT_LANGUAGES.has(language);
  const last = Math.min(lineCount, line + MAX_STATEMENT_LINES);
  let depth = 0;
  let quote: string | null = null;
  let blockComment = false;
  for (let current = line; current <= last; current += 1) {
    const text = lineAt(current);
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index]!;
      if (blockComment) {
        if (char === '*' && text[index + 1] === '/') {
          blockComment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (char === '\\') index += 1;
        else if (text.startsWith(quote, index)) {
          index += quote.length - 1;
          quote = null;
        }
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = hashComments && text.startsWith(char.repeat(3), index) ? char.repeat(3) : char;
        index += quote.length - 1;
      } else if (hashComments && char === '#') break;
      else if (!hashComments && char === '/' && text[index + 1] === '/') break;
      else if (!hashComments && char === '/' && text[index + 1] === '*') {
        blockComment = true;
        index += 1;
      } else if (OPEN.has(char)) depth += 1;
      else if (CLOSE.has(char)) depth -= 1;
    }
    // Only template literals and triple-quoted strings run on past a line end.
    if (quote && quote.length === 1 && quote !== '`') quote = null;
    if (depth <= 0 && !quote && !blockComment) return current;
  }
  return line;
}
