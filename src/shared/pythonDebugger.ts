import type { RelativePath, RootId } from './fs/brandedIds';

/** Hard limits applied at the untrusted renderer -> main boundary. */
export const MAX_PYTHON_DEBUG_SOURCE_BYTES = 1_000_000;
export const MAX_PYTHON_DEBUG_BREAKPOINTS = 100;
export const MAX_PYTHON_DEBUG_WATCHES = 20;
export const MAX_PYTHON_DEBUG_WATCH_LENGTH = 512;
export const MAX_PYTHON_DEBUG_ARGS = 64;
export const MAX_PYTHON_DEBUG_ARG_LENGTH = 4_096;

export type PythonDebuggerStepCommand = 'continue' | 'step-over' | 'step-into' | 'step-out';

export interface PythonDebuggerStartRequest {
  readonly tabId: string;
  readonly source: string;
  readonly fileName: string;
  /** Optional capability binding used only to derive an approved project cwd. */
  readonly rootId?: RootId;
  readonly relativePath?: RelativePath;
  readonly breakpoints: readonly number[];
  readonly watches: readonly string[];
  readonly userEnv?: Readonly<Record<string, string>>;
  readonly programArgs?: readonly string[];
}

interface PythonDebuggerCallStackFrame {
  readonly functionName: string;
  readonly line: number;
}

export interface PythonDebuggerPauseFrame {
  readonly tabId: string;
  readonly line: number;
  readonly reason: 'user-breakpoint' | 'step' | 'exception';
  readonly locals: Readonly<Record<string, string>>;
  readonly callStack: readonly PythonDebuggerCallStackFrame[];
  readonly watchResults: Readonly<
    Record<string, { readonly value?: string; readonly error?: string }>
  >;
}

export type PythonDebuggerFailureReason =
  | 'binary-missing'
  | 'command-failed'
  | 'invalid-request'
  | 'no-breakpoints'
  | 'process-exited'
  | 'session-not-found'
  | 'source-too-large'
  | 'unapproved-path';

export type PythonDebuggerResponse =
  | {
      readonly kind: 'paused';
      readonly sessionId: string;
      readonly frame: PythonDebuggerPauseFrame;
      readonly output: string;
      readonly outputTruncated?: boolean;
    }
  | {
      readonly kind: 'finished';
      readonly sessionId: string;
      readonly output: string;
      readonly outputTruncated?: boolean;
    }
  | { readonly kind: 'stopped'; readonly sessionId: string }
  | { readonly kind: 'synced'; readonly sessionId: string }
  | {
      readonly kind: 'error';
      readonly reason: PythonDebuggerFailureReason;
      readonly message?: string;
      /** Sanitized pdb/program output that helps explain the failure. */
      readonly output?: string;
      readonly outputTruncated?: boolean;
    };

export interface PythonDebuggerBridge {
  start: (request: PythonDebuggerStartRequest) => Promise<PythonDebuggerResponse>;
  command: (
    sessionId: string,
    command: PythonDebuggerStepCommand
  ) => Promise<PythonDebuggerResponse>;
  syncBreakpoints: (
    sessionId: string,
    breakpoints: readonly number[]
  ) => Promise<PythonDebuggerResponse>;
  syncWatches: (sessionId: string, watches: readonly string[]) => Promise<PythonDebuggerResponse>;
  stop: (sessionId: string) => Promise<PythonDebuggerResponse>;
}
