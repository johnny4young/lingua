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

import { MAX_NATIVE_STDERR_BYTES } from '../../shared/runnerLimits';
import {
  buildMissingRuntimeRecovery,
  type CliRuntimeRecovery,
} from './runtimeRecovery';

export const DEFAULT_CLI_RUN_TIMEOUT_MS = 30_000;
export const MIN_CLI_RUN_TIMEOUT_MS = 100;
export const MAX_CLI_RUN_TIMEOUT_MS = 5 * 60_000;

const KILL_ESCALATION_MS = 1_500;
const OUTPUT_TRUNCATION_MARKER = '\n[output truncated by Lingua CLI]\n';

export type CliRunStatus = 'success' | 'error' | 'timeout' | 'stopped';

export interface CliExecutionStep {
  command: string;
  args: string[];
  kind: 'prepare' | 'execute';
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
    | 'missing-runtime'
    | 'prepare-failed'
    | 'non-zero-exit'
    | 'timeout'
    | 'stopped'
    | 'spawn-failed';
  detail?: string;
  recovery?: CliRuntimeRecovery;
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
    env: NodeJS.ProcessEnv;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  }
): Promise<CliExecutionResult> {
  const startedAt = Date.now();
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
        return finish(plan, startedAt, result, stdout.value, stderr.value, 'error', {
          reason: missing ? 'missing-runtime' : 'spawn-failed',
          detail:
            missingRuntime?.detail ?? `Failed to start ${step.command}: ${result.spawnError.message}`,
          ...(missingRuntime ? { recovery: missingRuntime.recovery } : {}),
        });
      }
      if (result.timedOut) {
        return finish(plan, startedAt, result, stdout.value, stderr.value, 'timeout', {
          reason: 'timeout',
          detail: `Run timed out after ${timeoutMs}ms.`,
        });
      }
      if (result.stopped) {
        return finish(plan, startedAt, result, stdout.value, stderr.value, 'stopped', {
          reason: 'stopped',
          detail: 'Run stopped by SIGINT or SIGTERM.',
        });
      }
      if (result.exitCode !== 0) {
        return finish(plan, startedAt, result, stdout.value, stderr.value, 'error', {
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
  stdout: string,
  stderr: string,
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
    stdout,
    stderr,
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

    const finishStep = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      spawnError?: NodeJS.ErrnoException
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (escalationTimer) clearTimeout(escalationTimer);
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
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
    };

    const onSigint = () => terminate('stopped');
    const onSigterm = () => terminate('stopped');

    try {
      child = spawn(step.command, step.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
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
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);

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
    const markerBytes = Buffer.byteLength(OUTPUT_TRUNCATION_MARKER, 'utf8');
    const payloadCap = MAX_NATIVE_STDERR_BYTES - markerBytes;
    if (currentBytes + chunkBytes <= payloadCap) {
      this.value += chunk;
      return chunk;
    }

    const remainingBytes = Math.max(0, payloadCap - currentBytes);
    const prefix = truncateUtf8(chunk, remainingBytes);
    const accepted = `${prefix}${OUTPUT_TRUNCATION_MARKER}`;
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
    if (signal === 'SIGKILL' && typeof pid === 'number' && pid > 0) {
      try {
        execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {});
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
