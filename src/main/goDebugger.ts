import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  GoDebuggerPauseFrame,
  GoDebuggerStepCommand,
} from '../shared/goDebugger';
import { DapClient, type DapMessage } from './debugger/dapClient';
import { detachedSpawnOptions, killProcessTree } from './runners/processTree';

const execFileAsync = promisify(execFile);
const DELVE_START_TIMEOUT_MS = 5_000;
const DELVE_LAUNCH_TIMEOUT_MS = 45_000;
const DELVE_COMMAND_TIMEOUT_MS = 15_000;
const MAX_DELVE_STARTUP_BYTES = 64 * 1024;
const MAX_GO_DEBUG_OUTPUT_BYTES = 1_000_000;
const MAX_GO_DEBUG_VALUE_LENGTH = 4_096;
const MAX_GO_DEBUG_VARIABLES = 100;
const KILL_ESCALATION_DELAY_MS = 1_500;

interface DapBreakpoint {
  readonly verified?: boolean;
  readonly line?: number;
  readonly message?: string;
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

interface TransitionStopped {
  readonly kind: 'stopped';
  readonly threadId: number;
  readonly reason: string;
}

interface TransitionFinished {
  readonly kind: 'finished';
}

export type GoDebuggerTransition = TransitionStopped | TransitionFinished;

export interface GoDebugSessionOptions {
  readonly dlvPath: string;
  readonly scriptPath: string;
  readonly programDir: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly programArgs?: readonly string[];
}

export interface GoDebugOutput {
  readonly output: string;
  readonly outputTruncated: boolean;
}

function firstLine(value: string): string | null {
  const line = value.split(/\r?\n/u)[0]?.trim();
  return line ? line : null;
}

export async function resolveDelveBinary(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): Promise<{ command: string; version: string } | null> {
  const name = platform === 'win32' ? 'dlv.exe' : 'dlv';
  const candidates = [name];
  const gopath = env.GOPATH ?? process.env.GOPATH;
  if (gopath) {
    const first = gopath.split(path.delimiter)[0];
    if (first) candidates.push(path.join(first, 'bin', name));
  }
  candidates.push(path.join(homedir(), 'go', 'bin', name));

  for (const candidate of [...new Set(candidates)]) {
    try {
      if (path.isAbsolute(candidate)) await access(candidate);
      const { stdout, stderr } = await execFileAsync(candidate, ['version'], {
        env,
        timeout: DELVE_START_TIMEOUT_MS,
      });
      const version = firstLine(`${stdout}\n${stderr}`) ?? 'Delve';
      return { command: candidate, version };
    } catch {
      continue;
    }
  }
  return null;
}

function sameSource(left: string | undefined, right: string): boolean {
  return typeof left === 'string' && path.normalize(left) === path.normalize(right);
}

export class GoDebugSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private client: DapClient | null = null;
  private transitionQueue: GoDebuggerTransition[] = [];
  private transitionWaiter:
    | { resolve: (value: GoDebuggerTransition) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
    | null = null;
  private currentThreadId: number | null = null;
  private output = '';
  private outputBytes = 0;
  private outputTruncated = false;
  private finished = false;
  private killTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: GoDebugSessionOptions) {}

  async start(breakpoints: readonly number[]): Promise<GoDebuggerTransition> {
    if (this.child || this.client) throw new Error('Go debug session already started');
    const { child, client } = await this.launchServer();
    this.child = child;
    this.client = client;
    client.onEvent(message => this.onEvent(message));

    await client.request('initialize', {
      clientID: 'lingua',
      clientName: 'Lingua',
      adapterID: 'go',
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
      supportsVariableType: true,
      supportsVariablePaging: true,
    });

    const initialized = client.waitForEvent('initialized', undefined, DELVE_LAUNCH_TIMEOUT_MS);
    const launchOutcome = client
      .request(
        'launch',
        {
          name: 'Lingua Go debug',
          type: 'go',
          request: 'launch',
          mode: 'debug',
          program: this.options.programDir,
          cwd: this.options.cwd,
          args: [...(this.options.programArgs ?? [])],
          env: this.options.env,
          stopOnEntry: false,
          hideSystemGoroutines: true,
          stackTraceDepth: 50,
        },
        DELVE_LAUNCH_TIMEOUT_MS
      )
      .then(
        () => ({ ok: true as const }),
        error => ({ ok: false as const, error: error as Error })
      );
    await initialized;
    const verified = await this.setBreakpoints(breakpoints);
    if (verified.length === 0) throw new Error('Delve did not verify any requested breakpoint');
    await client.request('configurationDone', {}, DELVE_COMMAND_TIMEOUT_MS);
    const launch = await launchOutcome;
    if (!launch.ok) throw launch.error;
    return this.waitForTransition(DELVE_LAUNCH_TIMEOUT_MS);
  }

  async setBreakpoints(lines: readonly number[]): Promise<number[]> {
    const client = this.requireClient();
    const body = await client.request<{ breakpoints?: DapBreakpoint[] }>('setBreakpoints', {
      source: { name: path.basename(this.options.scriptPath), path: this.options.scriptPath },
      breakpoints: lines.map(line => ({ line })),
      sourceModified: false,
    });
    return (body.breakpoints ?? [])
      .filter(breakpoint => breakpoint.verified === true && Number.isInteger(breakpoint.line))
      .map(breakpoint => breakpoint.line!);
  }

  async command(command: GoDebuggerStepCommand): Promise<GoDebuggerTransition> {
    const client = this.requireClient();
    const threadId = this.currentThreadId;
    if (threadId === null) throw new Error('Go debugger is not paused');
    this.currentThreadId = null;
    const dapCommand =
      command === 'continue'
        ? 'continue'
        : command === 'step-over'
          ? 'next'
          : command === 'step-into'
            ? 'stepIn'
            : 'stepOut';
    await client.request(dapCommand, { threadId, singleThread: true }, DELVE_COMMAND_TIMEOUT_MS);
    return this.waitForTransition(DELVE_COMMAND_TIMEOUT_MS);
  }

  async inspect(
    tabId: string,
    watches: readonly string[],
    reason: GoDebuggerPauseFrame['reason']
  ): Promise<GoDebuggerPauseFrame> {
    const client = this.requireClient();
    const threadId = this.currentThreadId;
    if (threadId === null) throw new Error('Go debugger is not paused');
    const stackBody = await client.request<{ stackFrames?: DapStackFrame[] }>('stackTrace', {
      threadId,
      startFrame: 0,
      levels: 50,
    });
    const sourceFrames = (stackBody.stackFrames ?? []).filter(frame =>
      sameSource(frame.source?.path, this.options.scriptPath)
    );
    const active = sourceFrames[0];
    if (!active) throw new Error('Delve did not return a frame for the current source');

    const scopesBody = await client.request<{ scopes?: DapScope[] }>('scopes', {
      frameId: active.id,
    });
    const locals: Record<string, string> = {};
    let remaining = MAX_GO_DEBUG_VARIABLES;
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
        locals[variable.name] = String(variable.value).slice(0, MAX_GO_DEBUG_VALUE_LENGTH);
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
          value: String(evaluated.result ?? '').slice(0, MAX_GO_DEBUG_VALUE_LENGTH),
        };
      } catch (error) {
        watchResults[expression] = {
          error: (error instanceof Error ? error.message : 'Evaluation failed').slice(
            0,
            MAX_GO_DEBUG_VALUE_LENGTH
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

  drainOutput(): GoDebugOutput {
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
      void client.request('terminate', { restart: false }, 1_000).catch(() => undefined);
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
      this.transitionWaiter.reject(new Error('Go debugger stopped'));
      this.transitionWaiter = null;
    }
    this.transitionQueue = [];
  }

  private async launchServer(): Promise<{
    child: ChildProcessWithoutNullStreams;
    client: DapClient;
  }> {
    const child = spawn(this.options.dlvPath, ['dap', '--listen=127.0.0.1:0'], {
      cwd: this.options.programDir,
      env: this.options.env,
      shell: false,
      ...detachedSpawnOptions(),
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdin.on('error', () => undefined);
    const address = await new Promise<{ host: string; port: number }>((resolve, reject) => {
      let startup = '';
      const settle = (callback: () => void): void => {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        child.stderr.off('data', onData);
        child.off('error', onError);
        child.off('exit', onExit);
        callback();
      };
      const timer = setTimeout(() => {
        settle(() => {
          killProcessTree(child, 'SIGTERM');
          reject(new Error(`Delve DAP startup timed out: ${startup.trim()}`));
        });
      }, DELVE_START_TIMEOUT_MS);
      const onData = (chunk: string): void => {
        startup = `${startup}${chunk}`.slice(-MAX_DELVE_STARTUP_BYTES);
        const match = /DAP server listening at:\s*127\.0\.0\.1:(\d+)/u.exec(startup);
        if (!match) return;
        const port = Number(match[1]);
        if (!Number.isInteger(port) || port <= 0 || port > 65_535) return;
        settle(() => resolve({ host: '127.0.0.1', port }));
      };
      const onError = (error: Error): void => settle(() => reject(error));
      const onExit = (code: number | null): void =>
        settle(() => reject(new Error(`Delve exited before startup (${code ?? 'signal'}): ${startup}`)));
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('error', onError);
      child.once('exit', onExit);
    });
    child.once('exit', () => {
      if (this.killTimer) {
        clearTimeout(this.killTimer);
        this.killTimer = null;
      }
      if (!this.finished) this.pushTransition({ kind: 'finished' });
    });
    try {
      return { child, client: await DapClient.connect(address.host, address.port) };
    } catch (error) {
      killProcessTree(child, 'SIGTERM');
      throw error;
    }
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
    if (this.outputBytes <= MAX_GO_DEBUG_OUTPUT_BYTES) return;
    const tail = Buffer.from(this.output, 'utf8').subarray(-MAX_GO_DEBUG_OUTPUT_BYTES);
    this.output = tail.toString('utf8');
    this.outputBytes = Buffer.byteLength(this.output, 'utf8');
    this.outputTruncated = true;
  }

  private waitForTransition(timeoutMs: number): Promise<GoDebuggerTransition> {
    const queued = this.transitionQueue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.transitionWaiter) return Promise.reject(new Error('Go debugger command already pending'));
    return new Promise((resolve, reject) => {
      this.transitionWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.transitionWaiter = null;
          reject(new Error(`Go debugger transition timed out after ${timeoutMs}ms`));
        }, timeoutMs),
      };
    });
  }

  private pushTransition(transition: GoDebuggerTransition): void {
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
    if (!this.client || this.finished) throw new Error('Go debug session is not running');
    return this.client;
  }
}
