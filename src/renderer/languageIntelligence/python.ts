import i18next from 'i18next';
import type {
  LanguageIntelligenceAdapter,
  LanguageIntelligenceCompletion,
  LanguageIntelligenceDiagnostic,
  LanguageIntelligenceResult,
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

interface CandidateCompletion {
  label: string;
  kind: LanguageIntelligenceCompletion['kind'];
  detailKey: string;
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

function addCompletion(
  completions: Map<string, CandidateCompletion>,
  candidate: CandidateCompletion
): void {
  if (PYTHON_KEYWORDS.has(candidate.label)) return;
  if (completions.has(candidate.label)) return;
  completions.set(candidate.label, candidate);
}

function addIdentifierCompletions(
  completions: Map<string, CandidateCompletion>,
  rawNames: string,
  kind: CandidateCompletion['kind'],
  detailKey: string
): void {
  for (const match of rawNames.matchAll(IDENTIFIER)) {
    addCompletion(completions, {
      label: match[0],
      kind,
      detailKey,
    });
  }
}

function collectPythonCompletions(
  strippedLines: readonly string[]
): LanguageIntelligenceCompletion[] {
  const completions = new Map<string, CandidateCompletion>();

  for (const line of strippedLines) {
    const functionMatch = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
    const functionName = functionMatch?.[1];
    if (functionName) {
      addCompletion(completions, {
        label: functionName,
        kind: 'function',
        detailKey: 'languageIntelligence.python.completion.function',
      });
      const argsMatch = line.match(/\(([^)]*)\)/);
      const args = argsMatch?.[1];
      if (args) {
        addIdentifierCompletions(
          completions,
          args,
          'variable',
          'languageIntelligence.python.completion.variable'
        );
      }
      continue;
    }

    const classMatch = line.match(/^\s*class\s+([A-Za-z_]\w*)\s*(?:\(|:)/);
    const className = classMatch?.[1];
    if (className) {
      addCompletion(completions, {
        label: className,
        kind: 'class',
        detailKey: 'languageIntelligence.python.completion.class',
      });
      continue;
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
          addCompletion(completions, {
            label,
            kind: 'module',
            detailKey: 'languageIntelligence.python.completion.module',
          });
        }
      }
      continue;
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
          addCompletion(completions, {
            label,
            kind: 'module',
            detailKey: 'languageIntelligence.python.completion.module',
          });
        }
      }
      continue;
    }

    const assignmentMatch = line.match(/^\s*([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/);
    const assignmentName = assignmentMatch?.[1];
    if (assignmentName) {
      addCompletion(completions, {
        label: assignmentName,
        kind: 'variable',
        detailKey: 'languageIntelligence.python.completion.variable',
      });
    }

    const forMatch = line.match(/^\s*(?:async\s+)?for\s+(.+?)\s+in\b/);
    const forTargets = forMatch?.[1];
    if (forTargets) {
      addIdentifierCompletions(
        completions,
        forTargets,
        'variable',
        'languageIntelligence.python.completion.variable'
      );
    }
  }

  return [...completions.values()].map(completion => ({
    label: completion.label,
    kind: completion.kind,
    detail: t(completion.detailKey),
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

export function analyzePythonLanguageIntelligence(content: string): LanguageIntelligenceResult {
  const strippedLines = strippedPythonLines(content);

  return {
    diagnostics: analyzePythonDiagnostics(strippedLines),
    completions: collectPythonCompletions(strippedLines),
  };
}

export function createPythonLanguageIntelligenceAdapter(): LanguageIntelligenceAdapter {
  return {
    language: 'python',
    analyze: analyzePythonLanguageIntelligence,
  };
}
