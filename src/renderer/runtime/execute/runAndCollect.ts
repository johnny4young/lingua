/**
 * The run itself: the console sink every step writes to, and one
 * `runner.execute` call that streams output into the console and the result
 * panel while it runs, arms the countdown deadline, and records how the run
 * terminated.
 */

import { toConsoleEntry } from '../../hooks/runnerOutput';
import { createConsoleEntryBatcher, scheduleNextFrame } from '../../stores/consoleEntryBatcher';
import { useConsoleStore } from '../../stores/consoleStore';
import { useResultStore } from '../../stores/resultStore';
import type { FileTab } from '../../types/editor';
import type { NewConsoleEntry } from '../../types/console';
import type { ConsoleOutput, ExecutionResult, LanguageRunner } from '../../types/execution';
import { toExecutionPresentation } from '../../utils/executionPresentation';
import type { RunExecution } from './resolveRunPlan';

export interface RunConsole {
  /** Queue one entry; it reaches the store on the next flush. */
  add: (entry: NewConsoleEntry) => void;
  /** Deliver everything queued so far, synchronously. */
  flush: () => void;
  /** Entries this run has emitted so far. */
  count: () => number;
}

export interface CollectedRun {
  result: ExecutionResult;
  /** Console outputs the runner streamed while running, already in the console. */
  streamedConsoleCount: number;
}

export function createRunConsole(isCurrent: () => boolean = () => true): RunConsole {
  const { addEntries } = useConsoleStore.getState();
  let count = 0;
  // Console output is coalesced per frame: a worker posts one message per
  // stdout line, so a print loop used to cost one store update and one
  // re-render per line. Every exit path flushes so nothing stays queued
  // when the summary is returned.
  const entries = createConsoleEntryBatcher({
    addEntries: entries => {
      if (isCurrent()) addEntries(entries);
    },
    getClearVersion: () => useConsoleStore.getState().clearVersion,
  });
  return {
    add: entry => {
      if (!isCurrent()) return;
      count += 1;
      entries.push(entry);
    },
    flush: entries.flush,
    count: () => count,
  };
}

export async function runAndCollect(
  runner: Pick<LanguageRunner, 'execute'>,
  activeTab: FileTab,
  execution: RunExecution,
  runConsole: RunConsole,
  isCurrent: () => boolean = () => true
): Promise<CollectedRun> {
  const { language, content } = activeTab;
  const {
    setError,
    setExecutionTime,
    setFullOutput,
    setLineResults,
    setLineTimings,
    setRunDeadlineAt,
    setRunTermination,
  } = useResultStore.getState();

  const streamedStdout: ConsoleOutput[] = [];
  const streamedStderr: ConsoleOutput[] = [];
  let streamedConsoleCount = 0;
  let presentationPending = false;
  let settled = false;
  // A runner can stream one message per output line. Rebuild the result panel
  // at most once per frame, and never once the run has settled: the outcome
  // publishes the final presentation, which a late frame must not overwrite.
  const publishStreamedPresentation = () => {
    presentationPending = false;
    if (settled || !isCurrent()) return;
    const presentation = toExecutionPresentation(language, content, {
      stdout: streamedStdout,
      stderr: streamedStderr,
      result: undefined,
      executionTime: 0,
    });
    setLineResults(presentation.lineResults);
    setLineTimings([]);
    setFullOutput(presentation.fullOutput);
    setError(null);
    setExecutionTime(null);
  };
  const streamConsoleOutput = (output: ConsoleOutput) => {
    if (settled || !isCurrent()) return;
    streamedConsoleCount += 1;
    if (output.type === 'error') {
      streamedStderr.push(output);
    } else {
      streamedStdout.push(output);
    }
    runConsole.add(toConsoleEntry(output, language));
    if (!presentationPending && !settled) {
      presentationPending = true;
      scheduleNextFrame(publishStreamedPresentation);
    }
  };

  // implementation note — set the in-flight deadline so the countdown pill
  // can render `mm:ss` until termination; the pill reads
  // `useResultStore.runDeadlineAt` to compute the remaining time.
  if (execution.deadlineTimeoutMs !== undefined) {
    setRunDeadlineAt(Date.now() + execution.deadlineTimeoutMs);
  }

  let result: ExecutionResult;
  try {
    result = await runner.execute(content, {
      ...execution.context,
      onConsole: streamConsoleOutput,
    });
  } finally {
    settled = true;
  }
  if (!isCurrent()) return { result, streamedConsoleCount };
  // Tear down the in-flight deadline immediately; the pill flips to the
  // termination variant on the next render.
  setRunDeadlineAt(null);
  // implementation — propagate the termination summary so `<RunStatusPill>`
  // can render the right variant. Runners that don't set `kind` default to a
  // best-effort guess based on `error` / `cancelled`.
  const terminationKind: 'success' | 'error' | 'timeout' | 'stopped' =
    result.kind ?? (result.cancelled ? 'stopped' : result.error ? 'error' : 'success');
  setRunTermination({
    kind: terminationKind,
    timeoutPreset: result.timeoutPreset,
    timeoutMs: result.timeoutMs,
  });

  return { result, streamedConsoleCount };
}
