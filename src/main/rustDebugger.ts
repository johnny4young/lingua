import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  RustDebuggerPauseFrame,
  RustDebuggerStepCommand,
} from '../shared/rustDebugger';
import { DapClient } from './debugger/dapClient';
import {
  NativeDapSession,
  type NativeDapTransition,
} from './debugger/nativeDapSession';
import { detachedSpawnOptions, killProcessTree } from './runners/processTree';

const execFileAsync = promisify(execFile);
const TOOL_PROBE_TIMEOUT_MS = 5_000;
const LLDB_LAUNCH_TIMEOUT_MS = 45_000;
const LLDB_COMMAND_TIMEOUT_MS = 15_000;
const MAX_RUST_DEBUG_OUTPUT_BYTES = 1_000_000;

export type RustDebuggerTransition = NativeDapTransition;

export interface RustDebugSessionOptions {
  readonly lldbDapPath: string;
  readonly scriptPath: string;
  readonly binaryPath: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly programArgs?: readonly string[];
}

export interface RustDebugOutput {
  readonly output: string;
  readonly outputTruncated: boolean;
}

function firstLine(value: string): string | null {
  const line = value.split(/\r?\n/u)[0]?.trim();
  return line ? line : null;
}

async function probeBinary(
  candidate: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv
): Promise<{ command: string; version: string } | null> {
  try {
    if (path.isAbsolute(candidate)) await access(candidate);
    const { stdout, stderr } = await execFileAsync(candidate, [...args], {
      env,
      timeout: TOOL_PROBE_TIMEOUT_MS,
    });
    return { command: candidate, version: firstLine(`${stdout}\n${stderr}`) ?? candidate };
  } catch {
    return null;
  }
}

export async function resolveRustCompiler(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): Promise<{ command: string; version: string } | null> {
  const name = platform === 'win32' ? 'rustc.exe' : 'rustc';
  const candidates = [env.RUSTC, name].filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0
  );
  for (const candidate of [...new Set(candidates)]) {
    const result = await probeBinary(candidate, ['--version'], env);
    if (result) return result;
  }
  return null;
}

export async function resolveLldbDapBinary(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): Promise<{ command: string; version: string } | null> {
  const name = platform === 'win32' ? 'lldb-dap.exe' : 'lldb-dap';
  const candidates = [env.LLDB_DAP, name].filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0
  );

  if (platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('xcrun', ['--find', 'lldb-dap'], {
        env,
        timeout: TOOL_PROBE_TIMEOUT_MS,
      });
      const xcodeLldbDap = stdout.trim();
      if (xcodeLldbDap) candidates.push(xcodeLldbDap);
    } catch {
      // PATH and an explicit LLDB_DAP remain valid fallbacks without Xcode.
    }
  }

  for (const candidate of [...new Set(candidates)]) {
    const result = await probeBinary(candidate, ['--version'], env);
    if (result) return result;
  }
  return null;
}

async function launchLldbAdapter(options: RustDebugSessionOptions, signal: AbortSignal): Promise<{
  child: ChildProcessWithoutNullStreams;
  client: DapClient;
}> {
  signal.throwIfAborted();
  const child = spawn(options.lldbDapPath, [], {
    cwd: path.dirname(options.binaryPath),
    env: options.env,
    shell: false,
    ...detachedSpawnOptions(),
  });
  child.stdin.on('error', () => undefined);
  child.stderr.setEncoding('utf8');
  // Drain adapter diagnostics so stderr cannot backpressure the DAP process.
  child.stderr.on('data', () => undefined);
  const client = DapClient.fromStreams(child.stdin, child.stdout, {
    label: 'LLDB DAP',
    close: () => child.stdin.destroy(),
  });
  // Observe spawn errors synchronously: a missing executable emits on the
  // child, not just its streams, before a caller can adopt the adapter.
  child.on('error', () => client.close());
  try {
    await new Promise<void>((resolve, reject) => {
      const settle = (callback: () => void): void => {
        child.off('spawn', onSpawn);
        child.off('error', onError);
        signal.removeEventListener('abort', onAbort);
        callback();
      };
      const onSpawn = (): void => settle(resolve);
      const onError = (error: Error): void => settle(() => reject(error));
      const onAbort = (): void => settle(() => reject(signal.reason));
      child.once('spawn', onSpawn);
      child.once('error', onError);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    signal.throwIfAborted();
    return { child, client };
  } catch (error) {
    client.close();
    killProcessTree(child, 'SIGKILL');
    throw error;
  }
}

/** Rust-specific compilation target and LLDB launch around shared DAP state. */
export class RustDebugSession {
  private readonly session: NativeDapSession;

  constructor(options: RustDebugSessionOptions) {
    this.session = new NativeDapSession({
      runtimeName: 'Rust',
      adapterID: 'lldb',
      scriptPath: options.scriptPath,
      cwd: options.cwd,
      env: options.env,
      launchArguments: {
        name: 'Lingua Rust debug',
        type: 'lldb-dap',
        request: 'launch',
        program: options.binaryPath,
        cwd: options.cwd,
        args: [...(options.programArgs ?? [])],
        env: options.env,
        stopOnEntry: false,
      },
      startAdapter: signal => launchLldbAdapter(options, signal),
      closeRequest: { command: 'disconnect', arguments: { terminateDebuggee: true } },
      singleThreadCommands: false,
      launchTimeoutMs: LLDB_LAUNCH_TIMEOUT_MS,
      commandTimeoutMs: LLDB_COMMAND_TIMEOUT_MS,
      maxOutputBytes: MAX_RUST_DEBUG_OUTPUT_BYTES,
    });
  }

  start(breakpoints: readonly number[]): Promise<RustDebuggerTransition> {
    return this.session.start(breakpoints);
  }

  setBreakpoints(lines: readonly number[]): Promise<number[]> {
    return this.session.setBreakpoints(lines);
  }

  command(command: RustDebuggerStepCommand): Promise<RustDebuggerTransition> {
    return this.session.command(command);
  }

  inspect(
    tabId: string,
    watches: readonly string[],
    reason: RustDebuggerPauseFrame['reason']
  ): Promise<RustDebuggerPauseFrame> {
    return this.session.inspect(tabId, watches, reason);
  }

  drainOutput(): RustDebugOutput {
    return this.session.drainOutput();
  }

  terminate(force = false): void {
    this.session.terminate(force);
  }
}
