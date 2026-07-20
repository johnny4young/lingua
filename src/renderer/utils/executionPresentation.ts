import type { LineResult } from '../stores/resultStore';
import type { ExecutionResult, Language } from '../types';
import { isInlineResultLanguage } from './languageCapabilities';

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
  return isInlineResultLanguage(language);
}

export function toLineResults(result: ExecutionResult, code: string): LineResult[] {
  const lineResults: LineResult[] = [];
  const fallbackLine = getLastNonEmptyLine(code);

  for (const output of result.stdout) {
    lineResults.push({
      line: output.line ?? fallbackLine,
      value: output.args.join(' '),
      type: output.type,
    });
  }

  for (const output of result.stderr) {
    if (result.error && output.type === 'error') {
      continue;
    }

    lineResults.push({
      line: output.line ?? fallbackLine,
      value: output.args.join(' '),
      type: output.type,
    });
  }

  if (result.result !== undefined) {
    lineResults.push({
      line: fallbackLine,
      value: String(result.result),
      type: 'result',
    });
  }

  if (result.magicResults) {
    for (const magicResult of result.magicResults) {
      // implementation — runners tag each result with `kind` so the
      // panel can render the `@watch` pin distinct from the `=>`
      // arrow. implementation — adds `'autoLog'` (bare-expression
      // auto-capture). Default to `'magic'` for any runner that
      // emits a result without a kind (forward-compat with future
      // adapters).
      const type: LineResult['type'] =
        magicResult.kind === 'watch'
          ? 'watch'
          : magicResult.kind === 'autoLog'
            ? 'autoLog'
            : 'magic';
      // implementation — thread the typed payload through if the
      // runner attached one. `LineResult.payload` is optional so
      // results without rich data stay identical to legacy
      // behaviour.
      const entry: LineResult = {
        line: magicResult.line,
        value: magicResult.value,
        type,
      };
      if (magicResult.payload) entry.payload = magicResult.payload;
      lineResults.push(entry);
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
    if (result.error && output.type === 'error') {
      continue;
    }

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
