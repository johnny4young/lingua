/**
 * The run itself: the console sink every step writes to, and one
 * `runner.execute` call that streams output into the console and the result
 * panel while it runs, arms the countdown deadline, and records how the run
 * terminated.
 */

import { executionKind, primaryExecutionError } from '../../utils/executionOutcome';
import { toConsoleEntry } from '../../hooks/runnerOutput';
import { createConsoleEntryBatcher, scheduleNextFrame } from '../../stores/consoleEntryBatcher';
import { useConsoleStore } from '../../stores/consoleStore';
import { useResultStore } from '../../stores/resultStore';
import type { FileTab } from '../../types/editor';
import type { NewConsoleEntry } from '../../types/console';
import type { ConsoleOutput, ExecutionResult, LanguageRunner } from '../../types/execution';
import type { TimelineProgress } from '../../../shared/timeline';
import { toExecutionPresentation } from '../../utils/executionPresentation';
import type { RunExecution } from './resolveRunPlan';
import { replaceProgressOutput } from '../../runners/limits';
import { reportLiveRun } from '../../stores/liveRunStore';
import { useTimelineStore } from '../../stores/timelineStore';

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

/** A recording ends with its run: the whole timeline replaces the steps, a stopped run drops them, and one that timed out or crashed keeps them as cut short. */
function settleRecording(tab: FileTab, result: ExecutionResult | undefined, current: boolean): void {
  const timelines = useTimelineStore.getState();
  const kept = current && result !== undefined && !result.cancelled;
  if (kept && result.timeline) timelines.publish(tab.id, result.timeline, tab.content);
  // A crash posts no final timeline, so the step on the line that threw gets its error mark here.
  else timelines.endLive(tab.id, kept, kept && executionKind(result) === 'error' ? primaryExecutionError(result)?.line : undefined);
}

export async function runAndCollect(
  runner: Pick<LanguageRunner, 'execute'>,
  activeTab: FileTab,
  execution: RunExecution,
  runConsole: RunConsole,
  isCurrent: () => boolean = () => true,
  // Result-panel writes only; console streaming follows `isCurrent`.
  showsResults: () => boolean = isCurrent
): Promise<CollectedRun> {
  const { language, content } = activeTab;
  const {
    setError,
    setExecutionTime,
    setFullOutput,
    setLineResults,
    setLineTimings,
    setRunDeadlineAt,
    settleTabRun,
  } = useResultStore.getState();

  const streamedStdout: ConsoleOutput[] = [];
  const streamedStderr: ConsoleOutput[] = [];
  let streamedConsoleCount = 0;
  const observedOrders = new WeakMap<ConsoleOutput, number>();
  let presentationPending = false;
  let settled = false;
  // A runner can stream one message per output line. Rebuild the result panel
  // at most once per frame, and never once the run has settled: the outcome
  // publishes the final presentation, which a late frame must not overwrite.
  const publishStreamedPresentation = () => {
    presentationPending = false;
    if (settled || !showsResults()) return;
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
  const streamConsoleOutput = (captured: ConsoleOutput) => {
    if (settled || !isCurrent()) return;
    const output = { ...captured, captureOrder: captured.captureOrder ?? streamedConsoleCount };
    observedOrders.set(captured, output.captureOrder);
    streamedConsoleCount += 1;
    if (output.type === 'error') {
      streamedStderr.push(output);
    } else if (!replaceProgressOutput(streamedStdout, output)) {
      streamedStdout.push(output);
    }
    runConsole.add(toConsoleEntry(output, language));
    if (!presentationPending && !settled) {
      presentationPending = true;
      scheduleNextFrame(publishStreamedPresentation);
    }
  };

  // Set the in-flight deadline so the countdown pill
  // can render `mm:ss` until termination; the pill reads
  // `useResultStore.runDeadlineAt` to compute the remaining time.
  if (execution.deadlineTimeoutMs !== undefined && showsResults()) {
    setRunDeadlineAt(Date.now() + execution.deadlineTimeoutMs);
  }

  let result: ExecutionResult | undefined;
  const live = reportLiveRun(activeTab.id, content);
  const record = execution.context.record === true;
  try {
    result = await runner.execute(content, {
      ...execution.context,
      onConsole: streamConsoleOutput,
      onLive: live.onLive,
        ...(record
        ? {
            onTimeline: ({ steps, ms, marks }: TimelineProgress) => {
              if (settled || !isCurrent()) return;
              useTimelineStore.getState().grow(activeTab.id, steps, ms, content, marks);
              // A recording has no live signal; its latest step is where the run is, for the meter, rail and tape.
              const last = steps[steps.length - 1];
              if (last) live.onLive({ line: last.line, lineMs: Math.max(0, ms - (last.ms ?? ms)), elapsedMs: ms, loops: [] });
            },
          }
        : {}),
    });
  } finally {
    settled = true;
    live.end();
    if (record) settleRecording(activeTab, result, isCurrent());
  }
  // Runners may return the same captures without owning ordering metadata.
  // Reconcile by identity only; matching text could confuse repeated outputs.
  const retainObservedOrder = (output: ConsoleOutput): ConsoleOutput => {
    const captureOrder = output.captureOrder ?? observedOrders.get(output);
    return captureOrder === undefined || output.captureOrder !== undefined
      ? output : { ...output, captureOrder };
  };
  result = { ...result, stdout: result.stdout.map(retainObservedOrder), stderr: result.stderr.map(retainObservedOrder) };
  if (isCurrent()) {
    // Runners that don't set `kind` default to a best-effort guess based on `error` / `cancelled`.
    const line = primaryExecutionError(result)?.line;
    settleTabRun(
      activeTab.id,
      { kind: executionKind(result), timeoutPreset: result.timeoutPreset, timeoutMs: result.timeoutMs },
      { durationMs: result.executionTime ?? null, publish: showsResults(), ...(line ? { line } : {}) }
    );
  }
  if (!showsResults()) return { result, streamedConsoleCount };
  setRunDeadlineAt(null);

  return { result, streamedConsoleCount };
}
