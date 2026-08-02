import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import type {
  NativeDebuggerPauseFrame,
  NativeDebuggerStepCommand,
} from '../../shared/nativeDebugger';
import { DapClient, type DapMessage } from './dapClient';
import { killProcessTree } from '../runners/processTree';

const DEFAULT_LAUNCH_TIMEOUT_MS = 45_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
const DEFAULT_MAX_VALUE_LENGTH = 4_096;
const DEFAULT_MAX_VARIABLES = 100;
const KILL_ESCALATION_DELAY_MS = 1_500;

interface DapBreakpoint {
  readonly verified?: boolean;
  readonly line?: number;
}

interface DapStackFrame {
  readonly id: number;
  readonly name: string;
  readonly line: number;
  readonly source?: { readonly path?: string };
}

interface DapScope {
  readonly name: string;
  readonly variablesReference: number;
  readonly expensive?: boolean;
  readonly presentationHint?: string;
}

interface DapVariable {
  readonly name: string;
  readonly value: string;
}

export type NativeDapTransition =
  | { readonly kind: 'stopped'; readonly threadId: number; readonly reason: string }
  | { readonly kind: 'finished' };

export interface NativeDapSessionOptions {
  readonly runtimeName: string;
  readonly adapterID: string;
  readonly scriptPath: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly launchArguments: Readonly<Record<string, unknown>>;
  readonly startAdapter: () => Promise<{
    readonly child: ChildProcessWithoutNullStreams;
    readonly client: DapClient;
  }>;
  readonly closeRequest?:
    | { readonly command: 'terminate'; readonly arguments: Readonly<Record<string, unknown>> }
    | { readonly command: 'disconnect'; readonly arguments: Readonly<Record<string, unknown>> };
  readonly singleThreadCommands?: boolean;
  readonly launchTimeoutMs?: number;
  readonly commandTimeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxValueLength?: number;
  readonly maxVariables?: number;
}

function sameSource(left: string | undefined, right: string): boolean {
  return typeof left === 'string' && path.normalize(left) === path.normalize(right);
}

/** Shared bounded DAP lifecycle for the desktop Go and Rust adapters. */
export class NativeDapSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private client: DapClient | null = null;
  private transitionQueue: NativeDapTransition[] = [];
  private transitionWaiter:
    | {
        resolve: (value: NativeDapTransition) => void;
        reject: (error: Error) => void;
        timer: NodeJS.Timeout;
      }
    | null = null;
  private currentThreadId: number | null = null;
  private output = '';
  private outputBytes = 0;
  private outputTruncated = false;
  private finished = false;
  private killTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: NativeDapSessionOptions) {}

  async start(breakpoints: readonly number[]): Promise<NativeDapTransition> {
    if (this.child || this.client) {
      throw new Error(`${this.options.runtimeName} debug session already started`);
    }
    const { child, client } = await this.options.startAdapter();
    this.child = child;
    this.client = client;
    client.onEvent(message => this.onEvent(message));
    child.once('exit', () => {
      if (this.killTimer) {
        clearTimeout(this.killTimer);
        this.killTimer = null;
      }
      if (!this.finished) this.pushTransition({ kind: 'finished' });
    });

    await client.request('initialize', {
      clientID: 'lingua',
      clientName: 'Lingua',
      adapterID: this.options.adapterID,
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
      supportsVariableType: true,
      supportsVariablePaging: true,
    });

    const launchTimeoutMs = this.options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS;
    const initialized = client.waitForEvent('initialized', undefined, launchTimeoutMs);
    const launchOutcome = client
      .request('launch', this.options.launchArguments, launchTimeoutMs)
      .then(
        () => ({ ok: true as const }),
        error => ({ ok: false as const, error: error as Error })
      );

    // Some adapters reject launch before emitting initialized (notably LLDB
    // when macOS denies debugserver). Surface that diagnostic immediately
    // instead of replacing it with an initialized-event timeout.
    await Promise.race([
      initialized,
      launchOutcome.then(outcome => {
        if (!outcome.ok) throw outcome.error;
        return new Promise<never>(() => undefined);
      }),
    ]);
    await initialized;
    const verified = await this.setBreakpoints(breakpoints);
    if (verified.length === 0) {
      throw new Error(`${this.options.runtimeName} did not verify any requested breakpoint`);
    }
    await client.request('configurationDone', {}, this.commandTimeoutMs);
    const launch = await launchOutcome;
    if (!launch.ok) throw launch.error;
    return this.waitForTransition(launchTimeoutMs);
  }

  async setBreakpoints(lines: readonly number[]): Promise<number[]> {
    const body = await this.requireClient().request<{ breakpoints?: DapBreakpoint[] }>(
      'setBreakpoints',
      {
        source: { name: path.basename(this.options.scriptPath), path: this.options.scriptPath },
        breakpoints: lines.map(line => ({ line })),
        sourceModified: false,
      }
    );
    return (body.breakpoints ?? [])
      .filter(breakpoint => breakpoint.verified === true && Number.isInteger(breakpoint.line))
      .map(breakpoint => breakpoint.line!);
  }

  async command(command: NativeDebuggerStepCommand): Promise<NativeDapTransition> {
    const client = this.requireClient();
    const threadId = this.currentThreadId;
    if (threadId === null) throw new Error(`${this.options.runtimeName} debugger is not paused`);
    this.currentThreadId = null;
    const dapCommand =
      command === 'continue'
        ? 'continue'
        : command === 'step-over'
          ? 'next'
          : command === 'step-into'
            ? 'stepIn'
            : 'stepOut';
    await client.request(
      dapCommand,
      {
        threadId,
        ...(this.options.singleThreadCommands ? { singleThread: true } : {}),
      },
      this.commandTimeoutMs
    );
    return this.waitForTransition(this.commandTimeoutMs);
  }

  async inspect(
    tabId: string,
    watches: readonly string[],
    reason: NativeDebuggerPauseFrame['reason']
  ): Promise<NativeDebuggerPauseFrame> {
    const client = this.requireClient();
    const threadId = this.currentThreadId;
    if (threadId === null) throw new Error(`${this.options.runtimeName} debugger is not paused`);
    const stackBody = await client.request<{ stackFrames?: DapStackFrame[] }>('stackTrace', {
      threadId,
      startFrame: 0,
      levels: 50,
    });
    const sourceFrames = (stackBody.stackFrames ?? []).filter(frame =>
      sameSource(frame.source?.path, this.options.scriptPath)
    );
    const active = sourceFrames[0];
    if (!active) {
      throw new Error(`${this.options.runtimeName} did not return a frame for the current source`);
    }

    const scopesBody = await client.request<{ scopes?: DapScope[] }>('scopes', {
      frameId: active.id,
    });
    const locals: Record<string, string> = {};
    let remaining = this.options.maxVariables ?? DEFAULT_MAX_VARIABLES;
    const maxValueLength = this.options.maxValueLength ?? DEFAULT_MAX_VALUE_LENGTH;
    for (const scope of scopesBody.scopes ?? []) {
      if (scope.expensive || remaining <= 0) continue;
      if (!['locals', 'arguments'].includes((scope.presentationHint ?? scope.name).toLowerCase())) {
        continue;
      }
      const variablesBody = await client.request<{ variables?: DapVariable[] }>('variables', {
        variablesReference: scope.variablesReference,
        start: 0,
        count: remaining,
      });
      for (const variable of variablesBody.variables ?? []) {
        if (!variable.name || Object.hasOwn(locals, variable.name)) continue;
        locals[variable.name] = String(variable.value).slice(0, maxValueLength);
        remaining -= 1;
        if (remaining <= 0) break;
      }
    }

    const watchResults: Record<string, { value?: string; error?: string }> = {};
    for (const expression of watches) {
      try {
        const evaluated = await client.request<{ result?: string }>('evaluate', {
          expression,
          frameId: active.id,
          context: 'watch',
        });
        watchResults[expression] = {
          value: String(evaluated.result ?? '').slice(0, maxValueLength),
        };
      } catch (error) {
        watchResults[expression] = {
          error: (error instanceof Error ? error.message : 'Evaluation failed').slice(
            0,
            maxValueLength
          ),
        };
      }
    }

    return {
      tabId,
      line: active.line,
      reason,
      locals,
      callStack: sourceFrames.map(frame => ({
        functionName: frame.name || '<anonymous>',
        line: frame.line,
      })),
      watchResults,
    };
  }

  drainOutput(): { readonly output: string; readonly outputTruncated: boolean } {
    const result = { output: this.output.trim(), outputTruncated: this.outputTruncated };
    this.output = '';
    this.outputBytes = 0;
    this.outputTruncated = false;
    return result;
  }

  terminate(): void {
    if (this.finished && !this.child && !this.client) return;
    this.finished = true;
    const client = this.client;
    this.client = null;
    if (client) {
      const closeRequest = this.options.closeRequest ?? {
        command: 'disconnect' as const,
        arguments: { terminateDebuggee: true },
      };
      void client
        .request(closeRequest.command, { ...closeRequest.arguments }, 1_000)
        .catch(() => undefined);
      client.close();
    }
    const child = this.child;
    this.child = null;
    if (child) {
      killProcessTree(child, 'SIGTERM');
      if (this.killTimer === null) {
        this.killTimer = setTimeout(() => killProcessTree(child, 'SIGKILL'), KILL_ESCALATION_DELAY_MS);
        this.killTimer.unref?.();
      }
    }
    if (this.transitionWaiter) {
      clearTimeout(this.transitionWaiter.timer);
      this.transitionWaiter.reject(new Error(`${this.options.runtimeName} debugger stopped`));
      this.transitionWaiter = null;
    }
    this.transitionQueue = [];
  }

  private get commandTimeoutMs(): number {
    return this.options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  }

  private onEvent(message: DapMessage): void {
    const body = message.body as Record<string, unknown> | undefined;
    if (message.event === 'output' && typeof body?.output === 'string') {
      this.appendOutput(body.output);
      return;
    }
    if (message.event === 'stopped' && typeof body?.threadId === 'number') {
      this.currentThreadId = body.threadId;
      this.pushTransition({
        kind: 'stopped',
        threadId: body.threadId,
        reason: typeof body.reason === 'string' ? body.reason : 'breakpoint',
      });
      return;
    }
    if (message.event === 'terminated' || message.event === 'exited') {
      this.currentThreadId = null;
      if (!this.finished) {
        this.finished = true;
        this.pushTransition({ kind: 'finished' });
      }
    }
  }

  private appendOutput(chunk: string): void {
    this.output += chunk;
    this.outputBytes += Buffer.byteLength(chunk, 'utf8');
    const maxOutputBytes = this.options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (this.outputBytes <= maxOutputBytes) return;
    const tail = Buffer.from(this.output, 'utf8').subarray(-maxOutputBytes);
    this.output = tail.toString('utf8');
    this.outputBytes = Buffer.byteLength(this.output, 'utf8');
    this.outputTruncated = true;
  }

  private waitForTransition(timeoutMs: number): Promise<NativeDapTransition> {
    const queued = this.transitionQueue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.transitionWaiter) {
      return Promise.reject(new Error(`${this.options.runtimeName} debugger command already pending`));
    }
    return new Promise((resolve, reject) => {
      this.transitionWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.transitionWaiter = null;
          reject(new Error(`${this.options.runtimeName} debugger transition timed out after ${timeoutMs}ms`));
        }, timeoutMs),
      };
    });
  }

  private pushTransition(transition: NativeDapTransition): void {
    const waiter = this.transitionWaiter;
    if (!waiter) {
      this.transitionQueue.push(transition);
      return;
    }
    clearTimeout(waiter.timer);
    this.transitionWaiter = null;
    waiter.resolve(transition);
  }

  private requireClient(): DapClient {
    if (!this.client || this.finished) {
      throw new Error(`${this.options.runtimeName} debug session is not running`);
    }
    return this.client;
  }
}
