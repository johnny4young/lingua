/** Runtime-neutral shapes shared by owner-bound native debugger adapters. */

export type NativeDebuggerStepCommand = 'continue' | 'step-over' | 'step-into' | 'step-out';

interface NativeDebuggerCallStackFrame {
  readonly functionName: string;
  readonly line: number;
}

export interface NativeDebuggerPauseFrame {
  readonly tabId: string;
  readonly line: number;
  readonly reason: 'user-breakpoint' | 'step' | 'exception';
  readonly locals: Readonly<Record<string, string>>;
  readonly callStack: readonly NativeDebuggerCallStackFrame[];
  readonly watchResults: Readonly<
    Record<string, { readonly value?: string; readonly error?: string }>
  >;
}

export type NativeDebuggerResponse<FailureReason extends string> =
  | {
      readonly kind: 'paused';
      readonly sessionId: string;
      readonly frame: NativeDebuggerPauseFrame;
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
      readonly reason: FailureReason;
      readonly message?: string;
      readonly output?: string;
      readonly outputTruncated?: boolean;
    };

export interface NativeDebuggerBridge<StartRequest, FailureReason extends string> {
  start: (request: StartRequest) => Promise<NativeDebuggerResponse<FailureReason>>;
  command: (
    sessionId: string,
    command: NativeDebuggerStepCommand
  ) => Promise<NativeDebuggerResponse<FailureReason>>;
  syncBreakpoints: (
    sessionId: string,
    breakpoints: readonly number[]
  ) => Promise<NativeDebuggerResponse<FailureReason>>;
  syncWatches: (
    sessionId: string,
    watches: readonly string[]
  ) => Promise<NativeDebuggerResponse<FailureReason>>;
  stop: (sessionId: string) => Promise<NativeDebuggerResponse<FailureReason>>;
}
