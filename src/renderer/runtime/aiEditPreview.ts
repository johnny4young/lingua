import type { NetworkRunPolicy } from '../../shared/networkPolicy';
import { JavaScriptRunner } from '../runners/javascript';
import { PythonRunner } from '../runners/python';
import { TypeScriptRunner } from '../runners/typescript';
import type { ExecutionContext, ExecutionResult } from '../types/execution';

const PREVIEW_TIMEOUT_MS = 5_000;
const BLOCK_NETWORK: NetworkRunPolicy = { policy: 'block', allowedHosts: [], blockedHosts: [] };

export interface PreviewRun {
  error: string | null;
  stdout: string;
  executionTime: number;
}

/** `skipped`: the language has no sandboxed runner. */
export type EditPreview = { kind: 'ran'; before: PreviewRun; after: PreviewRun } | { kind: 'skipped' };

function summarize(result: ExecutionResult): PreviewRun {
  const error = result.error?.message ?? (result.kind === 'timeout' ? `Timed out after ${PREVIEW_TIMEOUT_MS / 1000} s` : null);
  return {
    error,
    stdout: result.stdout.map(output => output.args.join(' ')).join('\n'),
    executionTime: result.executionTime,
  };
}

/** A runner that rejects instead of reporting still shows as a failed run, so the dialog never waits forever. */
function failedRun(error: unknown): PreviewRun {
  return { error: error instanceof Error ? error.message : String(error), stdout: '', executionTime: 0 };
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
  const context: ExecutionContext = { language: language as ExecutionContext['language'], timeout: PREVIEW_TIMEOUT_MS, network: BLOCK_NETWORK };
  const run = async (code: string, scopeId: string): Promise<PreviewRun> => {
    try {
      return summarize(await runner.execute(code, { ...context, scopeId }));
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
