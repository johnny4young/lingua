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

const RUBY_KEYWORDS = new Set([
  'BEGIN',
  'END',
  'alias',
  'and',
  'begin',
  'break',
  'case',
  'class',
  'def',
  'defined?',
  'do',
  'else',
  'elsif',
  'end',
  'ensure',
  'false',
  'for',
  'if',
  'in',
  'module',
  'next',
  'nil',
  'not',
  'or',
  'redo',
  'rescue',
  'retry',
  'return',
  'self',
  'super',
  'then',
  'true',
  'undef',
  'unless',
  'until',
  'when',
  'while',
  'yield',
]);

const IDENTIFIER = /[A-Za-z_]\w*[!?=]?/g;
const IDENTIFIER_CHAR = /[A-Za-z0-9_!?=]/;
const BLOCK_OPENERS = /^(class|module|def|if|unless|case|while|until|for|begin)\b/;

interface RubyStripState {
  blockComment: boolean;
}

interface DelimiterEntry {
  char: '(' | '[' | '{';
  line: number;
  column: number;
}

interface BlockEntry {
  keyword: string;
  line: number;
  column: number;
}

interface RubySymbol {
  label: string;
  kind: LanguageIntelligenceSymbolKind;
  definedAtLine: number;
  detailKey: string;
  parameters?: LanguageIntelligenceSignatureParameter[];
}

interface RubySymbolTable {
  byName: Map<string, RubySymbol>;
}

interface RubyMethodSignature {
  name: string;
  argsString: string;
}

function t(key: string, options?: Record<string, unknown>): string {
  return i18next.t(key, options);
}

function blankRange(line: string, from: number, to: number): string {
  return `${line.slice(0, from)}${' '.repeat(Math.max(0, to - from))}${line.slice(to)}`;
}

function stripRubyLine(line: string, state: RubyStripState): string {
  const trimmed = line.trim();
  if (state.blockComment) {
    if (trimmed === '=end') state.blockComment = false;
    return ' '.repeat(line.length);
  }
  if (trimmed === '=begin') {
    state.blockComment = true;
    return ' '.repeat(line.length);
  }

  let stripped = line;
  let index = 0;

  while (index < stripped.length) {
    const char = stripped[index];
    if (char === '#') {
      return `${stripped.slice(0, index)}${' '.repeat(stripped.length - index)}`;
    }

    if (char === '"' || char === "'" || char === '`') {
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

function strippedRubyLines(content: string): string[] {
  const state: RubyStripState = { blockComment: false };
  return content.split('\n').map(line => stripRubyLine(line, state));
}

function rubyBlockKeyword(strippedLine: string): string | null {
  const trimmed = strippedLine.trim();
  if (!trimmed || trimmed === 'end') return null;

  const opener = trimmed.match(BLOCK_OPENERS)?.[1];
  if (opener) return opener;

  if (/\bdo(?:\s*\|[^|]*\|)?\s*$/.test(trimmed)) return 'do';
  return null;
}

function parseRubyMethodSignature(line: string): RubyMethodSignature | null {
  const match = line.match(
    /^\s*def\s+(?:(?:self|[A-Z]\w*(?:::[A-Z]\w*)*)\.)?([A-Za-z_]\w*[!?=]?)\s*(?:(?:\((.*)\))|(.+?))?\s*$/
  );
  const name = match?.[1];
  if (!name) return null;
  return {
    name,
    argsString: (match[2] ?? match[3] ?? '').trim(),
  };
}

function splitTopLevelArgs(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buffer = '';

  for (let index = 0; index < args.length; index += 1) {
    const char = args[index];
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

function addSymbol(table: RubySymbolTable, symbol: RubySymbol): void {
  if (RUBY_KEYWORDS.has(symbol.label)) return;
  if (table.byName.has(symbol.label)) return;
  table.byName.set(symbol.label, symbol);
}

function parameterNameFromLabel(label: string): string | null {
  const match = label.match(/^\s*[*&]{0,2}([A-Za-z_]\w*)\b/);
  const name = match?.[1];
  if (!name || RUBY_KEYWORDS.has(name)) return null;
  return name;
}

function addParameterSymbols(
  table: RubySymbolTable,
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
      detailKey: 'languageIntelligence.ruby.completion.variable',
    });
  }
}

function addBlockParameterSymbols(
  table: RubySymbolTable,
  rawNames: string,
  definedAtLine: number
): void {
  for (const match of rawNames.matchAll(IDENTIFIER)) {
    addSymbol(table, {
      label: match[0],
      kind: 'variable',
      definedAtLine,
      detailKey: 'languageIntelligence.ruby.completion.variable',
    });
  }
}

function buildRubySymbolTable(strippedLines: readonly string[]): RubySymbolTable {
  const table: RubySymbolTable = { byName: new Map() };

  strippedLines.forEach((line, index) => {
    const lineNumber = index + 1;

    const method = parseRubyMethodSignature(line);
    if (method) {
      const parameters = splitTopLevelArgs(method.argsString).map(label => ({ label }));
      addSymbol(table, {
        label: method.name,
        kind: 'function',
        definedAtLine: lineNumber,
        detailKey: 'languageIntelligence.ruby.completion.method',
        parameters,
      });
      addParameterSymbols(table, parameters, lineNumber);
      return;
    }

    const className = line.match(/^\s*class\s+([A-Z]\w*(?:::[A-Z]\w*)*)/)?.[1];
    if (className) {
      addSymbol(table, {
        label: className,
        kind: 'class',
        definedAtLine: lineNumber,
        detailKey: 'languageIntelligence.ruby.completion.class',
      });
      return;
    }

    const moduleName = line.match(/^\s*module\s+([A-Z]\w*(?:::[A-Z]\w*)*)/)?.[1];
    if (moduleName) {
      addSymbol(table, {
        label: moduleName,
        kind: 'module',
        definedAtLine: lineNumber,
        detailKey: 'languageIntelligence.ruby.completion.module',
      });
      return;
    }

    const assignmentName = line.match(/^\s*(@{0,2}[A-Za-z_]\w*)\s*=(?!=)/)?.[1];
    if (assignmentName) {
      addSymbol(table, {
        label: assignmentName,
        kind: 'variable',
        definedAtLine: lineNumber,
        detailKey: 'languageIntelligence.ruby.completion.variable',
      });
    }

    const blockParameters = line.match(/\|\s*([^|]+?)\s*\|/)?.[1];
    if (blockParameters) {
      addBlockParameterSymbols(table, blockParameters, lineNumber);
    }
  });

  return table;
}

function symbolsToCompletions(table: RubySymbolTable): LanguageIntelligenceCompletion[] {
  return [...table.byName.values()].map(symbol => ({
    label: symbol.label,
    kind: symbol.kind,
    detail: t(symbol.detailKey),
  }));
}

function analyzeRubyDiagnostics(
  strippedLines: readonly string[]
): LanguageIntelligenceDiagnostic[] {
  const diagnostics: LanguageIntelligenceDiagnostic[] = [];
  const delimiters: DelimiterEntry[] = [];
  const blocks: BlockEntry[] = [];
  const pairForClose: Record<string, DelimiterEntry['char']> = {
    ')': '(',
    ']': '[',
    '}': '{',
  };

  strippedLines.forEach((line, index) => {
    const lineNumber = index + 1;

    for (let offset = 0; offset < line.length; offset += 1) {
      const char = line[offset];
      if (char === '(' || char === '[' || char === '{') {
        delimiters.push({ char, line: lineNumber, column: offset + 1 });
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
        message: t('languageIntelligence.ruby.diagnostic.unexpectedClose', { char }),
        severity: 'error',
        source: 'language-intelligence',
      });
    }

    const trimmed = line.trim();
    if (trimmed === 'end') {
      const block = blocks.pop();
      if (!block) {
        diagnostics.push({
          line: lineNumber,
          column: Math.max(1, line.indexOf('end') + 1),
          endLine: lineNumber,
          endColumn: Math.max(4, line.indexOf('end') + 4),
          message: t('languageIntelligence.ruby.diagnostic.unexpectedEnd'),
          severity: 'error',
          source: 'language-intelligence',
        });
      }
      return;
    }

    const keyword = rubyBlockKeyword(line);
    if (keyword) {
      blocks.push({
        keyword,
        line: lineNumber,
        column: Math.max(1, line.search(/\S/) + 1),
      });
    }
  });

  for (const delimiter of delimiters.slice(-3)) {
    diagnostics.push({
      line: delimiter.line,
      column: delimiter.column,
      endLine: delimiter.line,
      endColumn: delimiter.column + 1,
      message: t('languageIntelligence.ruby.diagnostic.unclosedDelimiter', {
        char: delimiter.char,
      }),
      severity: 'error',
      source: 'language-intelligence',
    });
  }

  for (const block of blocks.slice(-3)) {
    diagnostics.push({
      line: block.line,
      column: block.column,
      endLine: block.line,
      endColumn: block.column + block.keyword.length,
      message: t('languageIntelligence.ruby.diagnostic.unclosedBlock', {
        keyword: block.keyword,
      }),
      severity: 'error',
      source: 'language-intelligence',
    });
  }

  return diagnostics;
}

function identifierAt(line: string, column: number): string | null {
  if (column < 1 || column > line.length + 1) return null;
  const offset = column - 1;
  let start = offset;
  while (start > 0 && IDENTIFIER_CHAR.test(line[start - 1] ?? '')) start -= 1;
  let end = offset;
  while (end < line.length && IDENTIFIER_CHAR.test(line[end] ?? '')) end += 1;
  if (start === end) return null;
  const word = line.slice(start, end);
  if (!/^[A-Za-z_]\w*[!?=]?$/.test(word)) return null;
  return word;
}

export function provideRubyHover(
  content: string,
  line: number,
  column: number
): LanguageIntelligenceHover | null {
  const strippedLines = strippedRubyLines(content);
  const target = strippedLines[line - 1];
  if (target === undefined) return null;
  const symbolName = identifierAt(target, column);
  if (!symbolName || RUBY_KEYWORDS.has(symbolName)) return null;

  const table = buildRubySymbolTable(strippedLines);
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
  if (!/^[A-Za-z_]\w*[!?=]?$/.test(callee)) return null;
  return { callee, startIndex: startIdx };
}

function isMethodDefinitionOpenParen(line: string, calleeStartIndex: number): boolean {
  const prefix = line.slice(0, calleeStartIndex).trimEnd();
  return /\bdef\s+(?:(?:self|[A-Z]\w*(?:::[A-Z]\w*)*)\.)?[A-Za-z_]\w*[!?=]?$/.test(prefix);
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
          identifier && !isMethodDefinitionOpenParen(text, identifier.startIndex)
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
        if (stack.at(-1)?.char === expectedOpen) stack.pop();
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

export function provideRubySignatureHelp(
  content: string,
  line: number,
  column: number
): LanguageIntelligenceSignatureHelp | null {
  const strippedLines = strippedRubyLines(content);
  if (line < 1 || line > strippedLines.length) return null;

  const enclosing = findEnclosingCall(strippedLines, line, column);
  if (!enclosing || RUBY_KEYWORDS.has(enclosing.callee)) return null;

  const table = buildRubySymbolTable(strippedLines);
  const symbol = table.byName.get(enclosing.callee);
  if (!symbol || symbol.kind !== 'function' || !symbol.parameters) return null;

  return {
    symbol: symbol.label,
    parameters: symbol.parameters,
    activeParameter: enclosing.activeParameter,
  };
}

export function analyzeRubyLanguageIntelligence(content: string): LanguageIntelligenceResult {
  const strippedLines = strippedRubyLines(content);
  const table = buildRubySymbolTable(strippedLines);

  return {
    diagnostics: analyzeRubyDiagnostics(strippedLines),
    completions: symbolsToCompletions(table),
  };
}

export function createRubyLanguageIntelligenceAdapter(): LanguageIntelligenceAdapter {
  return {
    language: 'ruby',
    analyze: analyzeRubyLanguageIntelligence,
    provideHover: provideRubyHover,
    provideSignatureHelp: provideRubySignatureHelp,
  };
}
