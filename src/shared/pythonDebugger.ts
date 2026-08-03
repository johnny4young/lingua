import type { RelativePath, RootId } from './fs/brandedIds';
import type {
  NativeDebuggerBridge,
  NativeDebuggerPauseFrame,
  NativeDebuggerResponse,
  NativeDebuggerStepCommand,
} from './nativeDebugger';

/** Hard limits applied at the untrusted renderer -> main boundary. */
export const MAX_PYTHON_DEBUG_SOURCE_BYTES = 1_000_000;
export const MAX_PYTHON_DEBUG_BREAKPOINTS = 100;
export const MAX_PYTHON_DEBUG_WATCHES = 20;
export const MAX_PYTHON_DEBUG_WATCH_LENGTH = 512;
export const MAX_PYTHON_DEBUG_ARGS = 64;
export const MAX_PYTHON_DEBUG_ARG_LENGTH = 4_096;

export type PythonDebuggerStepCommand = NativeDebuggerStepCommand;

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

export type PythonDebuggerPauseFrame = NativeDebuggerPauseFrame;

export type PythonDebuggerFailureReason =
  | 'binary-missing'
  | 'command-failed'
  | 'invalid-request'
  | 'no-breakpoints'
  | 'process-exited'
  | 'session-not-found'
  | 'source-too-large'
  | 'unapproved-path';

export type PythonDebuggerResponse = NativeDebuggerResponse<PythonDebuggerFailureReason>;

export type PythonDebuggerBridge = NativeDebuggerBridge<
  PythonDebuggerStartRequest,
  PythonDebuggerFailureReason
>;
