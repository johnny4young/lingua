import type { RelativePath, RootId } from './fs/brandedIds';
import type {
  NativeDebuggerBridge,
  NativeDebuggerPauseFrame,
  NativeDebuggerResponse,
  NativeDebuggerStepCommand,
} from './nativeDebugger';

export const MAX_RUST_DEBUG_SOURCE_BYTES = 1_000_000;
export const MAX_RUST_DEBUG_BREAKPOINTS = 100;
export const MAX_RUST_DEBUG_WATCHES = 20;
export const MAX_RUST_DEBUG_WATCH_LENGTH = 512;
export const MAX_RUST_DEBUG_ARGS = 64;
export const MAX_RUST_DEBUG_ARG_LENGTH = 4_096;

export type RustDebuggerStepCommand = NativeDebuggerStepCommand;
export type RustDebuggerPauseFrame = NativeDebuggerPauseFrame;

export interface RustDebuggerStartRequest {
  readonly tabId: string;
  readonly source: string;
  readonly fileName: string;
  readonly rootId?: RootId;
  readonly relativePath?: RelativePath;
  readonly breakpoints: readonly number[];
  readonly watches: readonly string[];
  readonly userEnv?: Readonly<Record<string, string>>;
  readonly programArgs?: readonly string[];
}

export type RustDebuggerFailureReason =
  | 'command-failed'
  | 'compile-failed'
  | 'invalid-request'
  | 'lldb-dap-missing'
  | 'no-breakpoints'
  | 'permission-required'
  | 'process-exited'
  | 'rustc-missing'
  | 'session-not-found'
  | 'source-too-large'
  | 'unapproved-path';

export type RustDebuggerResponse = NativeDebuggerResponse<RustDebuggerFailureReason>;
export type RustDebuggerBridge = NativeDebuggerBridge<
  RustDebuggerStartRequest,
  RustDebuggerFailureReason
>;
