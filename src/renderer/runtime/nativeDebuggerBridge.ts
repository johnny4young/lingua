import i18next from 'i18next';
import type {
  NativeDebuggerBridge,
  NativeDebuggerPauseFrame,
  NativeDebuggerResponse,
  NativeDebuggerStepCommand,
} from '../../shared/nativeDebugger';
import type { TelemetryTrack } from '../hooks/useTelemetry';
import {
  useDebuggerStore,
  type DebuggerRuntime,
  type PausedFrame,
} from '../stores/debuggerStore';
import type { FileTab } from '../types/editor';
import type { ConsoleOutput, ExecutionResult } from '../types/execution';

interface ActiveNativeDebugRun {
  readonly sessionId: string;
  readonly tabId: string;
  readonly startedAt: number;
  readonly onConsole?: (output: ConsoleOutput) => void;
  readonly track?: TelemetryTrack;
  readonly stdout: ConsoleOutput[];
  readonly resolve: (result: ExecutionResult) => void;
  commandPending: boolean;
  controlGeneration: number;
  settled: boolean;
  watchGeneration: number;
}

interface NativeDebuggerAdapterOptions<StartRequest, FailureReason extends string> {
  readonly runtime: Extract<DebuggerRuntime, 'python' | 'go'>;
  readonly i18nPrefix: 'pythonDebugger' | 'goDebugger';
  readonly commandFailedReason: FailureReason;
  readonly getBridge: () => NativeDebuggerBridge<StartRequest, FailureReason> | null;
  readonly buildStartRequest: (
    tab: FileTab,
    breakpoints: readonly number[],
    watches: readonly string[]
  ) => StartRequest;
}

export interface NativeDebuggerAdapter {
  execute: (
    tab: FileTab,
    onConsole?: (output: ConsoleOutput) => void,
    track?: TelemetryTrack
  ) => Promise<ExecutionResult>;
  isActive: () => boolean;
  dispatchCommand: (command: NativeDebuggerStepCommand) => boolean;
  syncBreakpoints: (lines: readonly number[]) => boolean;
  syncWatches: (watches: readonly string[]) => boolean;
  runToEnd: () => boolean;
  stop: () => boolean;
}

function toPausedFrame(frame: NativeDebuggerPauseFrame): PausedFrame {
  return {
    tabId: frame.tabId,
    line: frame.line,
    reason: frame.reason,
    locals: { ...frame.locals },
    callStack: frame.callStack.map(entry => ({ ...entry })),
    watchResults: { ...frame.watchResults },
  };
}

/**
 * Own the renderer lifecycle shared by native debuggers while leaving process
 * launch, protocol framing, and failure taxonomy inside each runtime adapter.
 */
export function createNativeDebuggerAdapter<StartRequest, FailureReason extends string>(
  options: NativeDebuggerAdapterOptions<StartRequest, FailureReason>
): NativeDebuggerAdapter {
  type Response = NativeDebuggerResponse<FailureReason>;
  let activeRun: ActiveNativeDebugRun | null = null;
  let startGeneration = 0;

  const failureMessage = (response: Extract<Response, { kind: 'error' }>): string => {
    const key = `${options.i18nPrefix}.error.${response.reason}`;
    const translated = i18next.t(key);
    if (translated !== key) return translated;
    return response.message || i18next.t(`${options.i18nPrefix}.error.command-failed`);
  };

  const streamOutput = (run: ActiveNativeDebugRun, response: Response): void => {
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
        args: [i18next.t(`${options.i18nPrefix}.outputTruncated`)],
      };
      run.stdout.push(output);
      run.onConsole?.(output);
    }
  };

  const settleRun = (
    run: ActiveNativeDebugRun,
    result: ExecutionResult,
    reasonBucket: 'run-complete' | 'crash' | 'stop' | 'user-detach'
  ): void => {
    if (run.settled) return;
    run.settled = true;
    if (activeRun === run) activeRun = null;
    useDebuggerStore.getState().setPausedFrame(null);
    useDebuggerStore.getState().detachSession();
    run.track?.('debugger.detached', { language: options.runtime, reasonBucket });
    run.resolve(result);
  };

  const applyResponse = (
    run: ActiveNativeDebugRun,
    response: Response,
    applyOptions: { trackPause?: boolean; detachReason?: 'run-complete' | 'user-detach' } = {}
  ): void => {
    if (run.settled || activeRun !== run) return;
    streamOutput(run, response);
    if (response.kind === 'paused') {
      useDebuggerStore.getState().setPausedFrame(toPausedFrame(response.frame));
      if (applyOptions.trackPause !== false) {
        run.track?.('debugger.paused', {
          language: options.runtime,
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
        applyOptions.detachReason ?? 'run-complete'
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
  };

  const immediateFailure = (message: string, startedAt: number): ExecutionResult => ({
    stdout: [],
    stderr: [],
    executionTime: performance.now() - startedAt,
    kind: 'error',
    error: { message },
  });

  const immediateResponseFailure = (
    response: Extract<Response, { kind: 'error' }>,
    startedAt: number,
    onConsole?: (output: ConsoleOutput) => void
  ): ExecutionResult => {
    const stdout: ConsoleOutput[] = [];
    if (response.output) stdout.push({ type: 'log', args: [response.output] });
    if (response.outputTruncated) {
      stdout.push({ type: 'warn', args: [i18next.t(`${options.i18nPrefix}.outputTruncated`)] });
    }
    for (const output of stdout) onConsole?.(output);
    return {
      stdout,
      stderr: [],
      executionTime: performance.now() - startedAt,
      kind: 'error',
      error: { message: failureMessage(response) },
    };
  };

  const commandError = (error: unknown): Extract<Response, { kind: 'error' }> => ({
    kind: 'error',
    reason: options.commandFailedReason,
    message: error instanceof Error ? error.message : String(error),
  });

  return {
    async execute(tab, onConsole, track) {
      const api = options.getBridge();
      const startedAt = performance.now();
      if (!api) {
        return immediateFailure(i18next.t(`${options.i18nPrefix}.error.desktop-only`), startedAt);
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
      let response: Response;
      try {
        response = await api.start(
          options.buildStartRequest(
            tab,
            breakpoints,
            debuggerState.watches.map(watch => watch.expression)
          )
        );
      } catch (error) {
        return immediateFailure(
          error instanceof Error
            ? error.message
            : i18next.t(`${options.i18nPrefix}.error.command-failed`),
          startedAt
        );
      }

      if (generation !== startGeneration) {
        if (response.kind === 'paused') await api.stop(response.sessionId).catch(() => undefined);
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
          stdout.push({
            type: 'warn',
            args: [i18next.t(`${options.i18nPrefix}.outputTruncated`)],
          });
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
        return immediateFailure(
          i18next.t(`${options.i18nPrefix}.error.process-exited`),
          startedAt
        );
      }

      return new Promise<ExecutionResult>(resolve => {
        const run: ActiveNativeDebugRun = {
          sessionId: response.sessionId,
          tabId: tab.id,
          startedAt,
          onConsole,
          track,
          stdout: [],
          resolve,
          commandPending: false,
          controlGeneration: 0,
          settled: false,
          watchGeneration: 0,
        };
        activeRun = run;
        useDebuggerStore.getState().attachSession({
          runtime: options.runtime,
          tabId: tab.id,
          attachedAt: Date.now(),
        });
        track?.('debugger.attached', { language: options.runtime, reasonBucket: 'attach' });
        applyResponse(run, response);
      });
    },

    isActive: () => activeRun !== null,

    dispatchCommand(command) {
      const run = activeRun;
      const api = options.getBridge();
      if (!run || !api || run.commandPending) return false;
      run.commandPending = true;
      const generation = ++run.controlGeneration;
      useDebuggerStore.getState().setPausedFrame(null);
      void api
        .command(run.sessionId, command)
        .then(response => {
          if (generation !== run.controlGeneration) return;
          run.commandPending = false;
          applyResponse(run, response);
        })
        .catch(error => {
          if (generation !== run.controlGeneration) return;
          run.commandPending = false;
          applyResponse(run, commandError(error));
        });
      return true;
    },

    syncBreakpoints(lines) {
      const run = activeRun;
      const api = options.getBridge();
      if (!run || !api) return false;
      const generation = run.controlGeneration;
      void api
        .syncBreakpoints(run.sessionId, lines)
        .then(response => {
          if (generation !== run.controlGeneration) return;
          if (response.kind === 'error') applyResponse(run, response);
        })
        .catch(error => {
          if (generation === run.controlGeneration) applyResponse(run, commandError(error));
        });
      return true;
    },

    syncWatches(watches) {
      const run = activeRun;
      const api = options.getBridge();
      if (!run || !api) return false;
      const controlGeneration = run.controlGeneration;
      const watchGeneration = ++run.watchGeneration;
      void api
        .syncWatches(run.sessionId, watches)
        .then(response => {
          if (
            controlGeneration !== run.controlGeneration ||
            watchGeneration !== run.watchGeneration
          ) {
            return;
          }
          applyResponse(run, response, { trackPause: false });
        })
        .catch(error => {
          if (
            controlGeneration === run.controlGeneration &&
            watchGeneration === run.watchGeneration
          ) {
            applyResponse(run, commandError(error));
          }
        });
      return true;
    },

    runToEnd() {
      const run = activeRun;
      const api = options.getBridge();
      if (!run || !api || run.commandPending) return false;
      run.commandPending = true;
      const generation = ++run.controlGeneration;
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
          if (!response || generation !== run.controlGeneration) return;
          run.commandPending = false;
          if (response.kind === 'paused') {
            streamOutput(run, response);
            void api.stop(run.sessionId).catch(() => undefined);
            settleRun(
              run,
              {
                stdout: [...run.stdout],
                stderr: [],
                executionTime: performance.now() - run.startedAt,
                kind: 'error',
                error: { message: i18next.t(`${options.i18nPrefix}.error.process-exited`) },
              },
              'crash'
            );
            return;
          }
          applyResponse(run, response, { detachReason: 'user-detach' });
        })
        .catch(error => {
          if (generation !== run.controlGeneration) return;
          run.commandPending = false;
          applyResponse(run, commandError(error));
        });
      return true;
    },

    stop() {
      startGeneration += 1;
      const run = activeRun;
      const api = options.getBridge();
      if (!run || !api) return false;
      const generation = ++run.controlGeneration;
      run.commandPending = true;
      void api
        .stop(run.sessionId)
        .then(response => {
          if (generation !== run.controlGeneration) return;
          run.commandPending = false;
          applyResponse(run, response);
        })
        .catch(() => {
          if (generation !== run.controlGeneration) return;
          run.commandPending = false;
          applyResponse(run, { kind: 'stopped', sessionId: run.sessionId });
        });
      return true;
    },
  };
}
