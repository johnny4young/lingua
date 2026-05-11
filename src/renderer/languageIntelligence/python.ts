import i18next from 'i18next';
import type {
  LanguageIntelligenceAdapter,
  LanguageIntelligenceCompletion,
  LanguageIntelligenceDiagnostic,
  LanguageIntelligenceHover,
  LanguageIntelligenceResult,
  LanguageIntelligenceSignatureHelp,
  LanguageIntelligenceSignatureParameter,
  LanguageIntelligenceSymbolKind,
} from './types';

const PYTHON_KEYWORDS = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);

const BLOCK_OPENERS =
  /^(?:(?:async\s+)?(?:def|for|with)|class|if|elif|else|while|try|except|finally|match|case)\b/;
const IDENTIFIER = /[A-Za-z_]\w*/g;
const IDENTIFIER_CHAR = /[A-Za-z0-9_]/;

interface TripleQuoteState {
  delimiter: '"""' | "'''" | null;
}

interface DelimiterEntry {
  char: '(' | '[' | '{';
  line: number;
  column: number;
}

interface PendingBlockHeader {
  line: number;
  column: number;
}

interface PythonSymbol {
  label: string;
  kind: LanguageIntelligenceSymbolKind;
  definedAtLine: number;
  detailKey: string;
  parameters?: LanguageIntelligenceSignatureParameter[];
}

interface PythonSymbolTable {
  byName: Map<string, PythonSymbol>;
}

interface PythonFunctionSignature {
  name: string;
  argsString: string;
}

function t(key: string, options?: Record<string, unknown>): string {
  return i18next.t(key, options);
}

function blankRange(line: string, from: number, to: number): string {
  return `${line.slice(0, from)}${' '.repeat(Math.max(0, to - from))}${line.slice(to)}`;
}

function stripLineForPythonAnalysis(line: string, state: TripleQuoteState): string {
  let stripped = line;
  let index = 0;

  while (index < stripped.length) {
    if (state.delimiter) {
      const end = stripped.indexOf(state.delimiter, index);
      if (end === -1) {
        return `${stripped.slice(0, index)}${' '.repeat(stripped.length - index)}`;
      }

      stripped = blankRange(stripped, index, end + state.delimiter.length);
      index = end + state.delimiter.length;
      state.delimiter = null;
      continue;
    }

    const char = stripped[index];
    const nextThree = stripped.slice(index, index + 3);

    if (nextThree === '"""' || nextThree === "'''") {
      state.delimiter = nextThree;
      stripped = blankRange(stripped, index, index + 3);
      index += 3;
      continue;
    }

    if (char === '#') {
      return `${stripped.slice(0, index)}${' '.repeat(stripped.length - index)}`;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      let end = index + 1;
      while (end < stripped.length) {
        if (stripped[end] === '\\') {
          end += 2;
          continue;
        }
        if (stripped[end] === quote) {
          end += 1;
          break;
        }
        end += 1;
      }
      stripped = blankRange(stripped, index, end);
      index = end;
      continue;
    }

    index += 1;
  }

  return stripped;
}

function strippedPythonLines(content: string): string[] {
  const state: TripleQuoteState = { delimiter: null };
  return content.split('\n').map(line => stripLineForPythonAnalysis(line, state));
}

function startsBlockHeader(strippedLine: string): boolean {
  const trimmed = strippedLine.trim();
  if (!trimmed) return false;
  return BLOCK_OPENERS.test(trimmed);
}

function parseFunctionSignature(
  strippedLines: readonly string[],
  startIndex: number
): PythonFunctionSignature | null {
  const line = strippedLines[startIndex] ?? '';
  const functionStart = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\((.*)$/);
  const name = functionStart?.[1];
  if (!name) return null;

  const parts: string[] = [];
  let depth = 1;
  let row = startIndex;
  let segment = functionStart?.[2] ?? '';

  while (row < strippedLines.length) {
    for (let index = 0; index < segment.length; index += 1) {
      const char = segment.charAt(index);
      if (char === '(') {
        depth += 1;
        parts.push(char);
        continue;
      }
      if (char === ')') {
        if (depth === 1) {
          return { name, argsString: parts.join('') };
        }
        depth -= 1;
        parts.push(char);
        continue;
      }
      parts.push(char);
    }

    row += 1;
    segment = strippedLines[row] ?? '';
    if (row < strippedLines.length) parts.push(' ');
  }

  return { name, argsString: parts.join('') };
}

function splitTopLevelArgs(args: string): string[] {
  // Split a parenthesised argument list by top-level commas — comma inside
  // brackets, parens, or braces (e.g. `Dict[str, int]`) stays attached to
  // the surrounding parameter.
  const parts: string[] = [];
  let depth = 0;
  let buffer = '';
  for (let i = 0; i < args.length; i += 1) {
    const char = args[i];
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      buffer += char;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
      buffer += char;
      continue;
    }
    if (char === ',' && depth === 0) {
      const trimmed = buffer.trim();
      if (trimmed) parts.push(trimmed);
      buffer = '';
      continue;
    }
    buffer += char;
  }
  const tail = buffer.trim();
  if (tail) parts.push(tail);
  return parts;
}

function addSymbol(
  table: PythonSymbolTable,
  symbol: PythonSymbol
): void {
  if (PYTHON_KEYWORDS.has(symbol.label)) return;
  if (table.byName.has(symbol.label)) return;
  table.byName.set(symbol.label, symbol);
}

function addIdentifierSymbols(
  table: PythonSymbolTable,
  rawNames: string,
  kind: LanguageIntelligenceSymbolKind,
  detailKey: string,
  definedAtLine: number
): void {
  for (const match of rawNames.matchAll(IDENTIFIER)) {
    addSymbol(table, {
      label: match[0],
      kind,
      definedAtLine,
      detailKey,
    });
  }
}

function parameterNameFromLabel(label: string): string | null {
  const match = label.match(/^\s*\*{0,2}([A-Za-z_]\w*)\b/);
  const name = match?.[1];
  if (!name || PYTHON_KEYWORDS.has(name)) return null;
  return name;
}

function addParameterSymbols(
  table: PythonSymbolTable,
  parameters: readonly LanguageIntelligenceSignatureParameter[],
  definedAtLine: number
): void {
  for (const parameter of parameters) {
    const label = parameterNameFromLabel(parameter.label);
    if (!label) continue;
    addSymbol(table, {
      label,
      kind: 'variable',
      definedAtLine,
      detailKey: 'languageIntelligence.python.completion.variable',
    });
  }
}

function buildPythonSymbolTable(strippedLines: readonly string[]): PythonSymbolTable {
  const table: PythonSymbolTable = { byName: new Map() };

  strippedLines.forEach((line, index) => {
    const lineNumber = index + 1;

    const functionSignature = parseFunctionSignature(strippedLines, index);
    if (functionSignature) {
      const argsString = functionSignature.argsString;
      const parameters = splitTopLevelArgs(argsString).map(label => ({ label }));
      addSymbol(table, {
        label: functionSignature.name,
        kind: 'function',
        definedAtLine: lineNumber,
        detailKey: 'languageIntelligence.python.completion.function',
        parameters,
      });
      addParameterSymbols(table, parameters, lineNumber);
      return;
    }

    const classMatch = line.match(/^\s*class\s+([A-Za-z_]\w*)\s*(?:\(|:)/);
    const className = classMatch?.[1];
    if (className) {
      addSymbol(table, {
        label: className,
        kind: 'class',
        definedAtLine: lineNumber,
        detailKey: 'languageIntelligence.python.completion.class',
      });
      return;
    }

    const importMatch = line.match(/^\s*import\s+(.+)$/);
    const importBody = importMatch?.[1];
    if (importBody) {
      for (const part of importBody.split(',')) {
        const aliasMatch = part
          .trim()
          .match(/^(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(?:\s+as\s+([A-Za-z_]\w*))?$/);
        const label = aliasMatch?.[1] ?? part.trim().split('.')[0];
        if (label) {
          addSymbol(table, {
            label,
            kind: 'module',
            definedAtLine: lineNumber,
            detailKey: 'languageIntelligence.python.completion.module',
          });
        }
      }
      return;
    }

    const fromImportMatch = line.match(
      /^\s*from\s+[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s+import\s+(.+)$/
    );
    const fromImportBody = fromImportMatch?.[1];
    if (fromImportBody) {
      for (const part of fromImportBody.split(',')) {
        const aliasMatch = part.trim().match(/^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?$/);
        const label = aliasMatch?.[2] ?? aliasMatch?.[1];
        if (label) {
          addSymbol(table, {
            label,
            kind: 'module',
            definedAtLine: lineNumber,
            detailKey: 'languageIntelligence.python.completion.module',
          });
        }
      }
      return;
    }

    const assignmentMatch = line.match(/^\s*([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/);
    const assignmentName = assignmentMatch?.[1];
    if (assignmentName) {
      addSymbol(table, {
        label: assignmentName,
        kind: 'variable',
        definedAtLine: lineNumber,
        detailKey: 'languageIntelligence.python.completion.variable',
      });
    }

    const forMatch = line.match(/^\s*(?:async\s+)?for\s+(.+?)\s+in\b/);
    const forTargets = forMatch?.[1];
    if (forTargets) {
      addIdentifierSymbols(
        table,
        forTargets,
        'variable',
        'languageIntelligence.python.completion.variable',
        lineNumber
      );
    }
  });

  return table;
}

function symbolsToCompletions(table: PythonSymbolTable): LanguageIntelligenceCompletion[] {
  return [...table.byName.values()].map(symbol => ({
    label: symbol.label,
    kind: symbol.kind,
    detail: t(symbol.detailKey),
  }));
}

function analyzePythonDiagnostics(
  strippedLines: readonly string[]
): LanguageIntelligenceDiagnostic[] {
  const diagnostics: LanguageIntelligenceDiagnostic[] = [];
  const delimiters: DelimiterEntry[] = [];
  let pendingBlockHeader: PendingBlockHeader | null = null;
  const pairForClose: Record<string, DelimiterEntry['char']> = {
    ')': '(',
    ']': '[',
    '}': '{',
  };

  strippedLines.forEach((line, index) => {
    const lineNumber = index + 1;
    const lineStartsBlockHeader = startsBlockHeader(line);
    let lineHasTopLevelColon = false;

    for (let offset = 0; offset < line.length; offset += 1) {
      const char = line[offset];
      if (char === ':' && delimiters.length === 0) {
        lineHasTopLevelColon = true;
        pendingBlockHeader = null;
        continue;
      }

      if (char === '(' || char === '[' || char === '{') {
        delimiters.push({
          char,
          line: lineNumber,
          column: offset + 1,
        });
        continue;
      }

      if (char !== ')' && char !== ']' && char !== '}') continue;

      const expected = pairForClose[char];
      const last = delimiters.at(-1);
      if (last?.char === expected) {
        delimiters.pop();
        continue;
      }

      diagnostics.push({
        line: lineNumber,
        column: offset + 1,
        endLine: lineNumber,
        endColumn: offset + 2,
        message: t('languageIntelligence.python.diagnostic.unexpectedClose', {
          char,
        }),
        severity: 'error',
        source: 'language-intelligence',
      });
    }

    if (lineStartsBlockHeader && !lineHasTopLevelColon && !pendingBlockHeader) {
      pendingBlockHeader = {
        line: lineNumber,
        column: Math.max(1, line.length),
      };
    }

    if (line.endsWith('\\')) return;

    if (pendingBlockHeader && delimiters.length === 0) {
      diagnostics.push({
        line: pendingBlockHeader.line,
        column: pendingBlockHeader.column,
        endLine: pendingBlockHeader.line,
        endColumn: pendingBlockHeader.column + 1,
        message: t('languageIntelligence.python.diagnostic.missingColon'),
        severity: 'error',
        source: 'language-intelligence',
      });
      pendingBlockHeader = null;
    }
  });

  for (const delimiter of delimiters.slice(-3)) {
    diagnostics.push({
      line: delimiter.line,
      column: delimiter.column,
      endLine: delimiter.line,
      endColumn: delimiter.column + 1,
      message: t('languageIntelligence.python.diagnostic.unclosedDelimiter', {
        char: delimiter.char,
      }),
      severity: 'error',
      source: 'language-intelligence',
    });
  }

  return diagnostics;
}

function identifierAt(line: string, column: number): string | null {
  // column is 1-based; the cursor sits between char (column - 1) and (column).
  // Treat the identifier as the run of identifier chars containing column - 1.
  if (column < 1 || column > line.length + 1) return null;
  const offset = column - 1;
  let start = offset;
  while (start > 0 && IDENTIFIER_CHAR.test(line[start - 1] ?? '')) start -= 1;
  let end = offset;
  while (end < line.length && IDENTIFIER_CHAR.test(line[end] ?? '')) end += 1;
  if (start === end) return null;
  const word = line.slice(start, end);
  if (!/^[A-Za-z_]\w*$/.test(word)) return null;
  return word;
}

export function providePythonHover(
  content: string,
  line: number,
  column: number
): LanguageIntelligenceHover | null {
  const strippedLines = strippedPythonLines(content);
  const target = strippedLines[line - 1];
  if (target === undefined) return null;
  const symbolName = identifierAt(target, column);
  if (!symbolName) return null;
  if (PYTHON_KEYWORDS.has(symbolName)) return null;

  const table = buildPythonSymbolTable(strippedLines);
  const symbol = table.byName.get(symbolName);
  if (!symbol) return null;

  const secondary =
    symbol.kind === 'function' && symbol.parameters
      ? `(${symbol.parameters.map(param => param.label).join(', ')})`
      : undefined;

  return {
    symbol: symbol.label,
    kind: symbol.kind,
    definedAtLine: symbol.definedAtLine,
    secondary,
  };
}

interface CallContext {
  callee: string;
  activeParameter: number;
}

interface OpenDelimiterContext {
  char: '(' | '[' | '{';
  callee?: string;
  activeParameter: number;
}

function identifierBeforeOpenParen(line: string, openParenIndex: number): {
  callee: string;
  startIndex: number;
} | null {
  let endIdx = openParenIndex;
  while (endIdx > 0 && /\s/.test(line[endIdx - 1] ?? '')) endIdx -= 1;
  let startIdx = endIdx;
  while (startIdx > 0 && IDENTIFIER_CHAR.test(line[startIdx - 1] ?? '')) {
    startIdx -= 1;
  }
  if (startIdx === endIdx) return null;
  const callee = line.slice(startIdx, endIdx);
  if (!/^[A-Za-z_]\w*$/.test(callee)) return null;
  return { callee, startIndex: startIdx };
}

function isFunctionDefinitionOpenParen(line: string, calleeStartIndex: number): boolean {
  const prefix = line.slice(0, calleeStartIndex).trimEnd();
  return /(?:^|\s)(?:async\s+)?def$/.test(prefix);
}

function matchingOpenFor(close: ')' | ']' | '}'): OpenDelimiterContext['char'] {
  return close === ')' ? '(' : close === ']' ? '[' : '{';
}

function findEnclosingCall(
  strippedLines: readonly string[],
  line: number,
  column: number
): CallContext | null {
  const stack: OpenDelimiterContext[] = [];

  for (let row = 0; row < line; row += 1) {
    const text = strippedLines[row] ?? '';
    const endColumnExclusive = row === line - 1 ? Math.max(0, column - 1) : text.length;
    for (let col = 0; col < endColumnExclusive; col += 1) {
      const char = text[col];
      if (char === '(') {
        const identifier = identifierBeforeOpenParen(text, col);
        const callee =
          identifier && !isFunctionDefinitionOpenParen(text, identifier.startIndex)
            ? identifier.callee
            : undefined;
        stack.push({ char, callee, activeParameter: 0 });
        continue;
      }

      if (char === '[' || char === '{') {
        stack.push({ char, activeParameter: 0 });
        continue;
      }

      if (char === ')' || char === ']' || char === '}') {
        const expectedOpen = matchingOpenFor(char);
        if (stack.at(-1)?.char === expectedOpen) {
          stack.pop();
        }
        continue;
      }

      const activeContext = stack.at(-1);
      if (char === ',' && activeContext?.callee) {
        activeContext.activeParameter += 1;
      }
    }
  }

  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const context = stack[index];
    if (context?.callee) {
      return {
        callee: context.callee,
        activeParameter: context.activeParameter,
      };
    }
  }
  return null;
}

export function providePythonSignatureHelp(
  content: string,
  line: number,
  column: number
): LanguageIntelligenceSignatureHelp | null {
  const strippedLines = strippedPythonLines(content);
  if (line < 1 || line > strippedLines.length) return null;

  const enclosing = findEnclosingCall(strippedLines, line, column);
  if (!enclosing) return null;
  if (PYTHON_KEYWORDS.has(enclosing.callee)) return null;

  const table = buildPythonSymbolTable(strippedLines);
  const symbol = table.byName.get(enclosing.callee);
  if (!symbol || symbol.kind !== 'function' || !symbol.parameters) return null;

  return {
    symbol: symbol.label,
    parameters: symbol.parameters,
    activeParameter: enclosing.activeParameter,
  };
}

export function analyzePythonLanguageIntelligence(content: string): LanguageIntelligenceResult {
  const strippedLines = strippedPythonLines(content);
  const table = buildPythonSymbolTable(strippedLines);

  return {
    diagnostics: analyzePythonDiagnostics(strippedLines),
    completions: symbolsToCompletions(table),
  };
}

export function createPythonLanguageIntelligenceAdapter(): LanguageIntelligenceAdapter {
  return {
    language: 'python',
    analyze: analyzePythonLanguageIntelligence,
    provideHover: providePythonHover,
    provideSignatureHelp: providePythonSignatureHelp,
  };
}
