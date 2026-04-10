import type { LineResult } from '../stores/resultStore';
import type { ExecutionResult, Language } from '../types';

const DYNAMIC_RESULT_LANGUAGES = new Set(['javascript', 'typescript', 'python']);

function getLastNonEmptyLine(code: string): number {
  const lines = code.split('\n');

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]!.trim()) {
      return index + 1;
    }
  }

  return lines.length;
}

export function isDynamicResultLanguage(language: Language): boolean {
  return DYNAMIC_RESULT_LANGUAGES.has(language);
}

export function toLineResults(result: ExecutionResult, code: string): LineResult[] {
  const lineResults: LineResult[] = [];

  for (const output of result.stdout) {
    if (output.line !== undefined) {
      lineResults.push({
        line: output.line,
        value: output.args.join(' '),
        type: output.type,
      });
    }
  }

  for (const output of result.stderr) {
    if (output.line !== undefined) {
      lineResults.push({
        line: output.line,
        value: output.args.join(' '),
        type: output.type,
      });
    }
  }

  if (result.result !== undefined) {
    lineResults.push({
      line: getLastNonEmptyLine(code),
      value: String(result.result),
      type: 'result',
    });
  }

  if (result.magicResults) {
    for (const magicResult of result.magicResults) {
      lineResults.push({
        line: magicResult.line,
        value: magicResult.value,
        type: 'magic',
      });
    }
  }

  return lineResults;
}

export function toFullOutput(result: ExecutionResult): string {
  const lines: string[] = [];

  for (const output of result.stdout) {
    lines.push(output.args.join(' '));
  }

  for (const output of result.stderr) {
    lines.push(output.args.join(' '));
  }

  return lines.join('\n');
}

export function toExecutionPresentation(
  language: Language,
  code: string,
  result: ExecutionResult
): {
  lineResults: LineResult[];
  fullOutput: string;
} {
  if (isDynamicResultLanguage(language)) {
    return {
      lineResults: toLineResults(result, code),
      fullOutput: '',
    };
  }

  return {
    lineResults: [],
    fullOutput: toFullOutput(result),
  };
}
