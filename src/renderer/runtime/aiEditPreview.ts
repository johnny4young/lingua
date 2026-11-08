import { JavaScriptRunner } from '../runners/javascript';
import { PythonRunner } from '../runners/python';
import { TypeScriptRunner } from '../runners/typescript';
import type { ExecutionContext, ExecutionResult } from '../types/execution';
import { toLineResults } from '../utils/executionPresentation';

const PREVIEW_TIMEOUT_MS = 5_000;

export interface PreviewRun {
  error: string | null;
  stdout: string;
  executionTime: number;
  /** The scratchpad's inline value for each line, the last one when a line runs more than once. */
  values: ReadonlyMap<number, string>;
}

/** `skipped`: the language has no sandboxed runner. */
export type EditPreview = { kind: 'ran'; before: PreviewRun; after: PreviewRun } | { kind: 'skipped' };

function summarize(result: ExecutionResult, code: string): PreviewRun {
  const error = result.error?.message ?? (result.kind === 'timeout' ? `Timed out after ${PREVIEW_TIMEOUT_MS / 1000} s` : null);
  const values = new Map<number, string>();
  for (const row of toLineResults(result, code)) if (row.type !== 'error') values.set(row.line, row.value);
  return {
    error,
    stdout: result.stdout.map(output => output.args.join(' ')).join('\n'),
    executionTime: result.executionTime,
    values,
  };
}

/** A runner that rejects instead of reporting still shows as a failed run, so the dialog never waits forever. */
function failedRun(error: unknown): PreviewRun {
  return { error: error instanceof Error ? error.message : String(error), stdout: '', executionTime: 0, values: new Map() };
}

/** Languages the preview can run in the browser. */
export function canPreviewLanguage(language: string): boolean {
  return language === 'javascript' || language === 'typescript' || language === 'python';
}

function previewRunner(language: string): JavaScriptRunner | TypeScriptRunner | PythonRunner | null {
  if (language === 'javascript') return new JavaScriptRunner();
  if (language === 'typescript') return new TypeScriptRunner();
  if (language === 'python') return new PythonRunner(true);
  return null;
}

/**
 * Runs the file as it is, then with the AI's change, on a runner of its own
 * that is stopped afterwards, so nothing the change leaves behind reaches a
 * tab's runtime. No network, a short timeout, nothing in the tab's console,
 * results or history.
 */
export async function runEditPreview(language: string, before: string, after: string): Promise<EditPreview> {
  const runner = previewRunner(language);
  if (!runner) return { kind: 'skipped' };
  const context: ExecutionContext = { language: language as ExecutionContext['language'], timeout: PREVIEW_TIMEOUT_MS, blockNetwork: true };
  const run = async (code: string, scopeId: string): Promise<PreviewRun> => {
    try {
      return summarize(await runner.execute(code, { ...context, scopeId }), code);
    } catch (error) {
      return failedRun(error);
    }
  };
  try {
    try {
      await runner.init();
    } catch (error) {
      return { kind: 'ran', before: failedRun(error), after: failedRun(error) };
    }
    const beforeRun = await run(before, 'ai-edit-before');
    const afterRun = await run(after, 'ai-edit-after');
    return { kind: 'ran', before: beforeRun, after: afterRun };
  } finally {
    runner.stop();
  }
}

export interface PreviewVerdict {
  fixed: number;
  introduced: number;
  stdoutChanged: boolean;
}

/** The badges under the preview: an error that went away, one that appeared, and whether the output differs. */
export function comparePreview(before: PreviewRun, after: PreviewRun): PreviewVerdict {
  return {
    fixed: before.error !== null && after.error === null ? 1 : 0,
    introduced: after.error !== null && (before.error === null || before.error !== after.error) ? 1 : 0,
    stdoutChanged: before.stdout !== after.stdout,
  };
}

export interface ValueChange {
  /** Line in the file with the change applied. */
  line: number;
  before: string | null;
  after: string | null;
}

const newlines = (text: string) => text.split('\n').length - 1;

/**
 * Lines whose inline value differs between the two runs. Lines below the
 * selection shift by the lines the change adds or removes; a line inside it
 * is compared with the same line of the original selection, if it had one.
 */
export function valueChanges(before: PreviewRun, after: PreviewRun, edit: { before: string; selected: string; proposal: string }): ValueChange[] {
  const start = newlines(edit.before) + 1;
  const oldEnd = start + newlines(edit.selected);
  const newEnd = start + newlines(edit.proposal);
  const toBefore = (line: number) => (line < start ? line : line > newEnd ? line - newEnd + oldEnd : line <= oldEnd ? line : null);
  const toAfter = (line: number) => (line < start ? line : line > oldEnd ? line - oldEnd + newEnd : Math.min(line, newEnd));
  const rows = new Map<number, ValueChange>();
  for (const [line, value] of after.values) {
    const from = toBefore(line);
    rows.set(line, { line, before: from === null ? null : (before.values.get(from) ?? null), after: value });
  }
  for (const [line, value] of before.values) {
    const target = toAfter(line);
    if (!rows.has(target)) rows.set(target, { line: target, before: value, after: after.values.get(target) ?? null });
  }
  return [...rows.values()].filter(row => row.before !== row.after).sort((a, b) => a.line - b.line);
}
