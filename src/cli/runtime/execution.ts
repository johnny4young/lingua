// SPDX-License-Identifier: MIT
/**
 * Shell-free subprocess execution for the headless CLI.
 *
 * The Electron main process owns a richer runner stack, but the CLI may not
 * import main/preload/renderer modules. This boundary therefore keeps only the
 * portable invariants the command-line surface needs: argument-vector spawns,
 * bounded output, stdin forwarding, parent-owned timeouts, whole-tree
 * termination, and deterministic result classification.
 */

import { truncateUtf8 } from '../../shared/utf8';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess, ChildProcessWithoutNullStreams } from 'node:child_process';
import { rm } from 'node:fs/promises';

import {
  CLI_OUTPUT_PAYLOAD_BYTES,
  CLI_OUTPUT_TRUNCATION_MARKER,
} from '../../shared/capsuleVerification';
import { buildMissingRuntimeRecovery, type CliRuntimeRecovery } from './runtimeRecovery';

export const DEFAULT_CLI_RUN_TIMEOUT_MS = 30_000;
export const MIN_CLI_RUN_TIMEOUT_MS = 100;
export const MAX_CLI_RUN_TIMEOUT_MS = 5 * 60_000;

const KILL_ESCALATION_MS = 1_500;
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

export type CliRunStatus = 'success' | 'error' | 'timeout' | 'stopped';

export interface CliExecutionStep {
  command: string;
  args: string[];
  kind: 'prepare' | 'execute';
  /** Set only when `args` already carry cmd.exe quoting. */
  windowsVerbatimArguments?: boolean;
}

export interface CliExecutionPlan {
  displayTarget: string;
  runtime: string;
  cwd: string;
  steps: CliExecutionStep[];
  cleanupPaths?: string[];
}

export interface CliExecutionResult {
  status: CliRunStatus;
  target: string;
  runtime: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  reason?:
    'missing-runtime' | 'prepare-failed' | 'non-zero-exit' | 'timeout' | 'stopped' | 'spawn-failed';
  detail?: string;
  recovery?: CliRuntimeRecovery;
  /** Present only when captured bytes were clipped; never infer this from text. */
  truncated?: { stdout: boolean; stderr: boolean };
}

interface StepResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
  stopped: boolean;
  spawnError?: NodeJS.ErrnoException;
}

export function clampCliRunTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_CLI_RUN_TIMEOUT_MS;
  return Math.min(MAX_CLI_RUN_TIMEOUT_MS, Math.max(MIN_CLI_RUN_TIMEOUT_MS, Math.floor(value)));
}

export async function executeCliPlan(
  plan: CliExecutionPlan,
  options: {
    stdin?: string;
    timeoutMs?: number;
    /** When the wall-clock budget began, if earlier than this call. */
    startedAt?: number;
    env: NodeJS.ProcessEnv;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  }
): Promise<CliExecutionResult> {
  const startedAt = options.startedAt ?? Date.now();
  const timeoutMs = clampCliRunTimeout(options.timeoutMs);
  const stdout = new CappedOutput();
  const stderr = new CappedOutput();

  try {
    for (const step of plan.steps) {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(1, timeoutMs - elapsed);
      const result = await runStep(step, {
        cwd: plan.cwd,
        env: options.env,
        timeoutMs: remaining,
        stdin: step.kind === 'execute' ? options.stdin : undefined,
        onStdout: chunk => forwardOutput(stdout, chunk, options.onStdout),
        onStderr: chunk => forwardOutput(stderr, chunk, options.onStderr),
      });

      if (result.spawnError) {
        const missing = result.spawnError.code === 'ENOENT';
        const missingRuntime = missing
          ? buildMissingRuntimeRecovery(step.command, plan.runtime)
          : undefined;
        return finish(plan, startedAt, result, stdout, stderr, 'error', {
          reason: missing ? 'missing-runtime' : 'spawn-failed',
          detail:
            missingRuntime?.detail ??
            `Failed to start ${step.command}: ${result.spawnError.message}`,
          ...(missingRuntime ? { recovery: missingRuntime.recovery } : {}),
        });
      }
      if (result.timedOut) {
        return finish(plan, startedAt, result, stdout, stderr, 'timeout', {
          reason: 'timeout',
          detail: `Run timed out after ${timeoutMs}ms.`,
        });
      }
      if (result.stopped) {
        return finish(plan, startedAt, result, stdout, stderr, 'stopped', {
          reason: 'stopped',
          detail: 'Run stopped by SIGINT, SIGTERM, or SIGHUP.',
        });
      }
      if (result.exitCode !== 0) {
        return finish(plan, startedAt, result, stdout, stderr, 'error', {
          reason: step.kind === 'prepare' ? 'prepare-failed' : 'non-zero-exit',
          detail:
            step.kind === 'prepare'
              ? `Runtime preparation exited with code ${result.exitCode ?? result.signal ?? 'unknown'}.`
              : `Program exited with code ${result.exitCode ?? result.signal ?? 'unknown'}.`,
        });
      }
    }

    const last = plan.steps.at(-1);
    return {
      status: 'success',
      target: plan.displayTarget,
      runtime: plan.runtime,
      durationMs: Date.now() - startedAt,
      exitCode: 0,
      signal: null,
      stdout: stdout.value,
      stderr: stderr.value,
      ...(stdout.truncated || stderr.truncated
        ? { truncated: { stdout: stdout.truncated, stderr: stderr.truncated } }
        : {}),
      ...(last ? {} : { detail: 'Execution plan contained no steps.' }),
    };
  } finally {
    await Promise.all(
      (plan.cleanupPaths ?? []).map(cleanupPath =>
        rm(cleanupPath, { recursive: true, force: true }).catch(() => {})
      )
    );
  }
}

function finish(
  plan: CliExecutionPlan,
  startedAt: number,
  result: StepResult,
  stdout: CappedOutput,
  stderr: CappedOutput,
  status: Exclude<CliRunStatus, 'success'>,
  diagnostic: Pick<CliExecutionResult, 'reason' | 'detail' | 'recovery'>
): CliExecutionResult {
  return {
    status,
    target: plan.displayTarget,
    runtime: plan.runtime,
    durationMs: Date.now() - startedAt,
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: stdout.value,
    stderr: stderr.value,
    ...(stdout.truncated || stderr.truncated
      ? { truncated: { stdout: stdout.truncated, stderr: stderr.truncated } }
      : {}),
    ...diagnostic,
  };
}

function runStep(
  step: CliExecutionStep,
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    stdin?: string;
    onStdout: (chunk: string) => void;
    onStderr: (chunk: string) => void;
  }
): Promise<StepResult> {
  return new Promise(resolve => {
    const startedAt = Date.now();
    let child: ChildProcessWithoutNullStreams;
    let settled = false;
    let timedOut = false;
    let stopped = false;
    let escalationTimer: NodeJS.Timeout | null = null;
    let exitGraceTimer: NodeJS.Timeout | null = null;
    let exited = false;
    let childExitCode: number | null = null;
    let childExitSignal: NodeJS.Signals | null = null;

    const finishStep = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      spawnError?: NodeJS.ErrnoException
    ) => {
      if (settled) return;
      settled = true;
      // Direct-child close is not evidence that its process group is gone.
      // Complete cancellation before clearing the force-kill deadline.
      if (timedOut || stopped) killProcessTree(child, 'SIGKILL');
      clearTimeout(timeoutTimer);
      if (escalationTimer) clearTimeout(escalationTimer);
      if (exitGraceTimer) clearTimeout(exitGraceTimer);
      for (const name of FORWARDED_SIGNALS) process.off(name, onSignal);
      resolve({
        exitCode,
        signal,
        durationMs: Date.now() - startedAt,
        timedOut,
        stopped,
        ...(spawnError ? { spawnError } : {}),
      });
    };

    const terminate = (reason: 'timeout' | 'stopped') => {
      if (settled) return;
      if (reason === 'timeout') timedOut = true;
      else stopped = true;
      killProcessTree(child, 'SIGTERM');
      escalationTimer ??= setTimeout(() => {
        killProcessTree(child, 'SIGKILL');
      }, KILL_ESCALATION_MS);
      if (exited) scheduleFinishAfterExit();
    };

    // An escaped descendant can retain the pipe after the owned child exits.
    // Bound collection without claiming that process groups are a sandbox.
    function scheduleFinishAfterExit(): void {
      if (settled || exitGraceTimer) return;
      exitGraceTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finishStep(childExitCode, childExitSignal);
      }, KILL_ESCALATION_MS);
    }

    // A repeat signal must not fall through to Node's default exit: the
    // detached child would outlive the CLI, so escalate immediately instead.
    let signalCount = 0;
    const onSignal = () => {
      signalCount += 1;
      if (signalCount === 1) terminate('stopped');
      else killProcessTree(child, 'SIGKILL');
    };

    try {
      child = spawn(step.command, step.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
        ...(step.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      });
    } catch (error) {
      const spawnError = asErrno(error);
      resolve({
        exitCode: null,
        signal: null,
        durationMs: Date.now() - startedAt,
        timedOut,
        stopped,
        spawnError,
      });
      return;
    }

    const timeoutTimer = setTimeout(() => terminate('timeout'), options.timeoutMs);
    for (const name of FORWARDED_SIGNALS) process.on(name, onSignal);

    child.stdin.on('error', () => {});
    try {
      if (options.stdin) child.stdin.write(options.stdin);
      child.stdin.end();
    } catch {
      // A fast-exiting child may close stdin before the parent writes.
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', options.onStdout);
    child.stderr.on('data', options.onStderr);
    child.once('error', error => finishStep(null, null, asErrno(error)));
    child.once('exit', (code, signal) => {
      exited = true;
      childExitCode = code;
      childExitSignal = signal;
      if (timedOut || stopped) scheduleFinishAfterExit();
    });
    child.once('close', (code, signal) => finishStep(code, signal));
  });
}

class CappedOutput {
  value = '';
  truncated = false;

  /** Returns exactly the bounded fragment newly accepted from this chunk. */
  append(chunk: string): string {
    if (this.truncated || !chunk) return '';
    const currentBytes = Buffer.byteLength(this.value, 'utf8');
    const chunkBytes = Buffer.byteLength(chunk, 'utf8');
    const payloadCap = CLI_OUTPUT_PAYLOAD_BYTES;
    if (currentBytes + chunkBytes <= payloadCap) {
      this.value += chunk;
      return chunk;
    }

    const remainingBytes = Math.max(0, payloadCap - currentBytes);
    const prefix = truncateUtf8(chunk, remainingBytes);
    const accepted = `${prefix}${CLI_OUTPUT_TRUNCATION_MARKER}`;
    this.value += accepted;
    this.truncated = true;
    return accepted;
  }
}

function forwardOutput(
  output: CappedOutput,
  chunk: string,
  listener: ((chunk: string) => void) | undefined
): void {
  const accepted = output.append(chunk);
  if (accepted) listener?.(accepted);
}

function asErrno(error: unknown): NodeJS.ErrnoException {
  return error instanceof Error ? (error as NodeJS.ErrnoException) : new Error(String(error));
}

function killProcessTree(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL'): void {
  const pid = child.pid;
  if (process.platform === 'win32') {
    // Killing just the parent first loses the ancestry taskkill needs. Never
    // target an already-exited Windows PID, which may have been recycled.
    if (typeof child.exitCode === 'number' || typeof child.signalCode === 'string') return;
    if (typeof pid === 'number' && pid > 0) {
      try {
        execFile('taskkill', ['/pid', String(pid), '/T', '/F'], error => {
          if (!error) return;
          try {
            child.kill(signal);
          } catch {
            /* Already gone. */
          }
        });
        return;
      } catch {
        // Fall through to the direct signal.
      }
    }
    try {
      child.kill(signal);
    } catch {
      // Already gone.
    }
    return;
  }
  if (typeof pid === 'number' && pid > 0) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // The group may already be reaped; direct child is the fallback.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Already gone.
  }
}
