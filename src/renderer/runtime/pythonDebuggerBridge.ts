import i18next from 'i18next';
import { asRelativePath, asRootId } from '../../shared/fs/brandedIds';
import type {
  PythonDebuggerPauseFrame,
  PythonDebuggerResponse,
  PythonDebuggerStepCommand,
} from '../../shared/pythonDebugger';
import { resolveUserEnvForRunner } from '../runners/env';
import type { TelemetryTrack } from '../hooks/useTelemetry';
import { useDebuggerStore, type PausedFrame } from '../stores/debuggerStore';
import type { FileTab } from '../types/editor';
import type { ConsoleOutput, ExecutionResult } from '../types/execution';

interface ActivePythonDebugRun {
  readonly sessionId: string;
  readonly tabId: string;
  readonly startedAt: number;
  readonly onConsole?: (output: ConsoleOutput) => void;
  readonly track?: TelemetryTrack;
  readonly stdout: ConsoleOutput[];
  readonly resolve: (result: ExecutionResult) => void;
  settled: boolean;
}

let activeRun: ActivePythonDebugRun | null = null;
let startGeneration = 0;

function bridge(): NonNullable<LinguaAPI['pythonDebugger']> | null {
  return typeof window !== 'undefined' ? (window.lingua?.pythonDebugger ?? null) : null;
}

function failureMessage(response: Extract<PythonDebuggerResponse, { kind: 'error' }>): string {
  const key = `pythonDebugger.error.${response.reason}`;
  const translated = i18next.t(key);
  if (translated !== key) return translated;
  return response.message || i18next.t('pythonDebugger.error.command-failed');
}

function toPausedFrame(frame: PythonDebuggerPauseFrame): PausedFrame {
  return {
    tabId: frame.tabId,
    line: frame.line,
    reason: frame.reason,
    locals: { ...frame.locals },
    callStack: frame.callStack.map(entry => ({
      functionName: entry.functionName,
      line: entry.line,
    })),
    watchResults: { ...frame.watchResults },
  };
}

function streamOutput(run: ActivePythonDebugRun, response: PythonDebuggerResponse): void {
  if (response.kind !== 'paused' && response.kind !== 'finished' && response.kind !== 'error') {
    return;
  }
  if (response.output) {
    const output: ConsoleOutput = { type: 'log', args: [response.output] };
    run.stdout.push(output);
    run.onConsole?.(output);
  }
  if (response.outputTruncated) {
    const output: ConsoleOutput = {
      type: 'warn',
      args: [i18next.t('pythonDebugger.outputTruncated')],
    };
    run.stdout.push(output);
    run.onConsole?.(output);
  }
}

function settleRun(
  run: ActivePythonDebugRun,
  result: ExecutionResult,
  reasonBucket: 'run-complete' | 'crash' | 'stop' | 'user-detach'
): void {
  if (run.settled) return;
  run.settled = true;
  if (activeRun === run) activeRun = null;
  useDebuggerStore.getState().setPausedFrame(null);
  useDebuggerStore.getState().detachSession();
  run.track?.('debugger.detached', { language: 'python', reasonBucket });
  run.resolve(result);
}

function applyResponse(
  run: ActivePythonDebugRun,
  response: PythonDebuggerResponse,
  options: { trackPause?: boolean; detachReason?: 'run-complete' | 'user-detach' } = {}
): void {
  streamOutput(run, response);
  if (response.kind === 'paused') {
    useDebuggerStore.getState().setPausedFrame(toPausedFrame(response.frame));
    if (options.trackPause !== false) {
      run.track?.('debugger.paused', {
        language: 'python',
        reasonBucket: response.frame.reason,
      });
    }
    return;
  }
  if (response.kind === 'finished') {
    settleRun(
      run,
      {
        stdout: [...run.stdout],
        stderr: [],
        executionTime: performance.now() - run.startedAt,
        kind: 'success',
      },
      options.detachReason ?? 'run-complete'
    );
    return;
  }
  if (response.kind === 'stopped') {
    settleRun(
      run,
      {
        stdout: [...run.stdout],
        stderr: [],
        executionTime: performance.now() - run.startedAt,
        cancelled: true,
        kind: 'stopped',
        error: { message: i18next.t('runner.stopped.message') },
      },
      'stop'
    );
    return;
  }
  if (response.kind === 'error') {
    settleRun(
      run,
      {
        stdout: [...run.stdout],
        stderr: [],
        executionTime: performance.now() - run.startedAt,
        kind: 'error',
        error: { message: failureMessage(response) },
      },
      'crash'
    );
  }
}

function immediateFailure(message: string, startedAt: number): ExecutionResult {
  return {
    stdout: [],
    stderr: [],
    executionTime: performance.now() - startedAt,
    kind: 'error',
    error: { message },
  };
}

function immediateResponseFailure(
  response: Extract<PythonDebuggerResponse, { kind: 'error' }>,
  startedAt: number,
  onConsole?: (output: ConsoleOutput) => void
): ExecutionResult {
  const stdout: ConsoleOutput[] = [];
  if (response.output) {
    stdout.push({ type: 'log', args: [response.output] });
  }
  if (response.outputTruncated) {
    stdout.push({ type: 'warn', args: [i18next.t('pythonDebugger.outputTruncated')] });
  }
  for (const output of stdout) onConsole?.(output);
  return {
    stdout,
    stderr: [],
    executionTime: performance.now() - startedAt,
    kind: 'error',
    error: { message: failureMessage(response) },
  };
}

export async function executePythonDebugSession(
  tab: FileTab,
  onConsole?: (output: ConsoleOutput) => void,
  track?: TelemetryTrack
): Promise<ExecutionResult> {
  const api = bridge();
  const startedAt = performance.now();
  if (!api) {
    return immediateFailure(i18next.t('pythonDebugger.error.desktop-only'), startedAt);
  }

  const generation = ++startGeneration;
  if (activeRun) {
    const previous = activeRun;
    const stopped = await api
      .stop(previous.sessionId)
      .catch(() => ({ kind: 'stopped', sessionId: previous.sessionId }) as const);
    applyResponse(previous, stopped);
  }
  const debuggerState = useDebuggerStore.getState();
  const breakpoints = debuggerState
    .breakpointsForTab(tab.id)
    .filter(breakpoint => breakpoint.enabled !== false)
    .map(breakpoint => breakpoint.line);
  let response: PythonDebuggerResponse;
  try {
    response = await api.start({
      tabId: tab.id,
      source: tab.content,
      fileName: tab.name,
      ...(tab.rootId && tab.relativePath
        ? {
            rootId: asRootId(tab.rootId),
            relativePath: asRelativePath(tab.relativePath),
          }
        : {}),
      breakpoints,
      watches: debuggerState.watches.map(watch => watch.expression),
      userEnv: resolveUserEnvForRunner(),
      ...(tab.inputArgs && tab.inputArgs.length > 0 ? { programArgs: tab.inputArgs } : {}),
    });
  } catch (error) {
    return immediateFailure(
      error instanceof Error ? error.message : i18next.t('pythonDebugger.error.command-failed'),
      startedAt
    );
  }

  if (generation !== startGeneration) {
    if (response.kind === 'paused') {
      await api.stop(response.sessionId).catch(() => undefined);
    }
    return {
      stdout: [],
      stderr: [],
      executionTime: performance.now() - startedAt,
      cancelled: true,
      kind: 'stopped',
      error: { message: i18next.t('runner.stopped.message') },
    };
  }
  if (response.kind === 'error') {
    return immediateResponseFailure(response, startedAt, onConsole);
  }
  if (response.kind === 'finished') {
    const stdout: ConsoleOutput[] = response.output
      ? [{ type: 'log' as const, args: [response.output] }]
      : [];
    if (response.outputTruncated) {
      stdout.push({ type: 'warn', args: [i18next.t('pythonDebugger.outputTruncated')] });
    }
    for (const output of stdout) onConsole?.(output);
    return {
      stdout,
      stderr: [],
      executionTime: performance.now() - startedAt,
      kind: 'success',
    };
  }
  if (response.kind !== 'paused') {
    return immediateFailure(i18next.t('pythonDebugger.error.process-exited'), startedAt);
  }

  return new Promise<ExecutionResult>(resolve => {
    const run: ActivePythonDebugRun = {
      sessionId: response.sessionId,
      tabId: tab.id,
      startedAt,
      onConsole,
      track,
      stdout: [],
      resolve,
      settled: false,
    };
    activeRun = run;
    useDebuggerStore.getState().attachSession({
      runtime: 'python',
      tabId: tab.id,
      attachedAt: Date.now(),
    });
    track?.('debugger.attached', { language: 'python', reasonBucket: 'attach' });
    applyResponse(run, response);
  });
}

export function isPythonDebuggerActive(): boolean {
  return activeRun !== null;
}

export function dispatchPythonDebuggerCommand(command: PythonDebuggerStepCommand): boolean {
  const run = activeRun;
  const api = bridge();
  if (!run || !api) return false;
  void api
    .command(run.sessionId, command)
    .then(response => applyResponse(run, response))
    .catch(error =>
      applyResponse(run, {
        kind: 'error',
        reason: 'command-failed',
        message: error instanceof Error ? error.message : String(error),
      })
    );
  return true;
}

export function syncPythonDebuggerBreakpoints(lines: readonly number[]): boolean {
  const run = activeRun;
  const api = bridge();
  if (!run || !api) return false;
  void api
    .syncBreakpoints(run.sessionId, lines)
    .then(response => {
      if (response.kind === 'error') applyResponse(run, response);
    })
    .catch(error =>
      applyResponse(run, {
        kind: 'error',
        reason: 'command-failed',
        message: error instanceof Error ? error.message : String(error),
      })
    );
  return true;
}

export function syncPythonDebuggerWatches(watches: readonly string[]): boolean {
  const run = activeRun;
  const api = bridge();
  if (!run || !api) return false;
  void api
    .syncWatches(run.sessionId, watches)
    .then(response => applyResponse(run, response, { trackPause: false }))
    .catch(error =>
      applyResponse(run, {
        kind: 'error',
        reason: 'command-failed',
        message: error instanceof Error ? error.message : String(error),
      })
    );
  return true;
}

export function runPythonDebuggerToEnd(): boolean {
  const run = activeRun;
  const api = bridge();
  if (!run || !api) return false;
  void api
    .syncBreakpoints(run.sessionId, [])
    .then(response => {
      if (response.kind === 'error') {
        applyResponse(run, response);
        return null;
      }
      return api.command(run.sessionId, 'continue');
    })
    .then(response => {
      if (!response) return;
      if (response.kind === 'paused') {
        // Run to end detaches the visible controls immediately. pdb may still
        // stop for an uncaught exception after breakpoints are cleared; do not
        // publish an orphan paused frame with no attached session.
        streamOutput(run, response);
        void api.stop(run.sessionId).catch(() => undefined);
        settleRun(
          run,
          {
            stdout: [...run.stdout],
            stderr: [],
            executionTime: performance.now() - run.startedAt,
            kind: 'error',
            error: { message: i18next.t('pythonDebugger.error.process-exited') },
          },
          'crash'
        );
        return;
      }
      applyResponse(run, response, { detachReason: 'user-detach' });
    })
    .catch(error =>
      applyResponse(run, {
        kind: 'error',
        reason: 'command-failed',
        message: error instanceof Error ? error.message : String(error),
      })
    );
  return true;
}

export function stopActivePythonDebugger(): boolean {
  startGeneration += 1;
  const run = activeRun;
  const api = bridge();
  if (!run || !api) return false;
  void api
    .stop(run.sessionId)
    .then(response => applyResponse(run, response))
    .catch(() => applyResponse(run, { kind: 'stopped', sessionId: run.sessionId }));
  return true;
}
