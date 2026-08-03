import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GoDebuggerPauseFrame, GoDebuggerStepCommand } from '../shared/goDebugger';
import { DapClient } from './debugger/dapClient';
import {
  NativeDapSession,
  type NativeDapTransition,
} from './debugger/nativeDapSession';
import { detachedSpawnOptions, killProcessTree } from './runners/processTree';

const execFileAsync = promisify(execFile);
const DELVE_START_TIMEOUT_MS = 5_000;
const DELVE_LAUNCH_TIMEOUT_MS = 45_000;
const DELVE_COMMAND_TIMEOUT_MS = 15_000;
const MAX_DELVE_STARTUP_BYTES = 64 * 1024;
const MAX_GO_DEBUG_OUTPUT_BYTES = 1_000_000;

export type GoDebuggerTransition = NativeDapTransition;

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

async function launchDelveAdapter(options: GoDebugSessionOptions): Promise<{
  child: ChildProcessWithoutNullStreams;
  client: DapClient;
}> {
  const child = spawn(options.dlvPath, ['dap', '--listen=127.0.0.1:0'], {
    cwd: options.programDir,
    env: options.env,
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
  try {
    return { child, client: await DapClient.connect(address.host, address.port) };
  } catch (error) {
    killProcessTree(child, 'SIGTERM');
    throw error;
  }
}

/** Go-specific launch configuration around the shared bounded DAP lifecycle. */
export class GoDebugSession {
  private readonly session: NativeDapSession;

  constructor(options: GoDebugSessionOptions) {
    this.session = new NativeDapSession({
      runtimeName: 'Go',
      adapterID: 'go',
      scriptPath: options.scriptPath,
      cwd: options.cwd,
      env: options.env,
      launchArguments: {
        name: 'Lingua Go debug',
        type: 'go',
        request: 'launch',
        mode: 'debug',
        program: options.programDir,
        cwd: options.cwd,
        args: [...(options.programArgs ?? [])],
        env: options.env,
        stopOnEntry: false,
        hideSystemGoroutines: true,
        stackTraceDepth: 50,
      },
      startAdapter: () => launchDelveAdapter(options),
      closeRequest: { command: 'terminate', arguments: { restart: false } },
      singleThreadCommands: true,
      launchTimeoutMs: DELVE_LAUNCH_TIMEOUT_MS,
      commandTimeoutMs: DELVE_COMMAND_TIMEOUT_MS,
      maxOutputBytes: MAX_GO_DEBUG_OUTPUT_BYTES,
    });
  }

  start(breakpoints: readonly number[]): Promise<GoDebuggerTransition> {
    return this.session.start(breakpoints);
  }

  setBreakpoints(lines: readonly number[]): Promise<number[]> {
    return this.session.setBreakpoints(lines);
  }

  command(command: GoDebuggerStepCommand): Promise<GoDebuggerTransition> {
    return this.session.command(command);
  }

  inspect(
    tabId: string,
    watches: readonly string[],
    reason: GoDebuggerPauseFrame['reason']
  ): Promise<GoDebuggerPauseFrame> {
    return this.session.inspect(tabId, watches, reason);
  }

  drainOutput(): GoDebugOutput {
    return this.session.drainOutput();
  }

  terminate(): void {
    this.session.terminate();
  }
}
