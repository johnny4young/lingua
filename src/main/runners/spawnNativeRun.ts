/**
 * T6 — shared native-run machinery for the desktop language runners.
 *
 * The Node, Ruby, and Rust runners each hand-rolled the same
 * `spawn(...)` + timeout + SIGTERM→SIGKILL escalation + output-cap +
 * ENOENT-classification loop. This helper absorbs that common
 * machinery so the runners keep ONLY their language-specific parts
 * (toolchain detection, argument construction, temp-file handling,
 * result-shape mapping, and their user-facing/i18n error + truncation
 * strings).
 *
 * Behavior is a verbatim lift of what those runners did inline:
 *
 *   - `spawn()` WITHOUT a shell — no string interpolation, so command
 *     injection is impossible at this layer.
 *   - Process-group leader on POSIX (`detachedSpawnOptions()`) so a
 *     timeout / stop can fell the whole tree via `killProcessTree()`,
 *     not just the direct child.
 *   - Parent-owned timeout: after `timeoutMs` we send SIGTERM and
 *     escalate to SIGKILL `killEscalationMs` later if the child has
 *     not exited.
 *   - Optional user-driven abort (Stop button) via an `AbortSignal`,
 *     using the same SIGTERM→SIGKILL escalation.
 *   - stdout / stderr each accumulated and capped at `maxOutputBytes`
 *     with the caller-supplied truncation markers via `truncateBytes`.
 *   - Optional stdin forwarding (write-then-end, with the async EPIPE
 *     guard) — opt-in so runners that never touch stdin (Rust) keep
 *     their exact posture.
 *
 * The helper resolves a NEUTRAL result and never classifies the run
 * into a runner-specific `kind`. Callers map `timedOut` / `killed` /
 * `exitCode` / `spawnError` into their own result shape and messages —
 * those strings are asserted by tests and the i18n copy guard and must
 * not be reworded here.
 */

import * as childProc from 'node:child_process';
import { truncateBytes } from '../../shared/runnerLimits';
import { detachedSpawnOptions, killProcessTree } from './processTree';

export interface SpawnNativeRunOptions {
  /** Executable to run. Absolute path or PATH-resolved name. */
  command: string;
  /** Argument vector. Passed straight through — never shell-parsed. */
  args: string[];
  /** Working directory. `undefined` inherits the parent's cwd. */
  cwd?: string;
  /** Fully-resolved subprocess environment. */
  env: NodeJS.ProcessEnv;
  /** Parent-owned wall-clock budget (ms) before SIGTERM. */
  timeoutMs: number;
  /** SIGTERM→SIGKILL escalation window (ms) after a kill is triggered. */
  killEscalationMs: number;
  /** Byte cap applied to each of stdout / stderr. */
  maxOutputBytes: number;
  /** Truncation marker appended when stdout is clipped. */
  stdoutTruncationMarker: string;
  /** Truncation marker appended when stderr is clipped. */
  stderrTruncationMarker: string;
  /**
   * Opt into stdin management. When set, the helper attaches the async
   * EPIPE guard, writes `stdin.data` (when non-empty), and closes the
   * stream so the child hits EOF on first read. Omit it entirely to
   * leave the child's stdin untouched (Rust's posture).
   *
   * F-7 interactive mode: when `keepOpen` is true the helper writes `data`
   * but does NOT close the stream, and hands the writable to `onStream` so
   * the caller can forward later input (and owns closing it). The default
   * (write-once-then-close) posture is unchanged when `keepOpen` is falsy.
   */
  stdin?: {
    data?: string;
    keepOpen?: boolean;
    onStream?: (stdin: NodeJS.WritableStream) => void;
  };
  /** Observer fired for each raw stdout chunk (before capping). */
  onStdout?: (chunk: string) => void;
  /** Observer fired for each raw stderr chunk (before capping). */
  onStderr?: (chunk: string) => void;
  /** Aborting this signal terminates the run as a user Stop. */
  signal?: AbortSignal;
}

export interface SpawnNativeRunResult {
  stdout: string;
  stderr: string;
  /** `code ?? -1` from the child's `close`, or `-1` on spawn error. */
  exitCode: number;
  /** ms from spawn to resolution. */
  executionTime: number;
  /** True when the parent timeout fired and killed the child. */
  timedOut: boolean;
  /** True when the caller's `signal` aborted the run (Stop button). */
  killed: boolean;
  /** Set when the child emitted `error` (spawn failure, e.g. ENOENT). */
  spawnError?: Error;
}

/**
 * Spawn a native subprocess and resolve once it exits (or fails to
 * spawn). Never rejects — every failure mode resolves a structured
 * result so IPC callers can map it without a try/catch around the
 * promise.
 */
export function spawnNativeRun(
  options: SpawnNativeRunOptions
): Promise<SpawnNativeRunResult> {
  const {
    command,
    args,
    cwd,
    env,
    timeoutMs,
    killEscalationMs,
    maxOutputBytes,
    stdoutTruncationMarker,
    stderrTruncationMarker,
    stdin,
    onStdout,
    onStderr,
    signal,
  } = options;

  return new Promise<SpawnNativeRunResult>((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let resolved = false;
    let timedOut = false;
    let killed = false;
    let escalationTimer: NodeJS.Timeout | null = null;

    let child: childProc.ChildProcessWithoutNullStreams;
    try {
      child = childProc.spawn(command, args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        // Process-group leader on POSIX so timeout/Stop can fell the whole
        // tree (user code that forks/spawns) via killProcessTree, not just
        // the direct child. See src/main/runners/processTree.ts.
        ...detachedSpawnOptions(),
      });
    } catch (err) {
      // `spawn()` can throw SYNCHRONOUSLY for invalid args/options (e.g. a
      // command containing a null byte) — distinct from the ASYNC 'error' event
      // it emits for ENOENT. Honor the documented "never rejects" contract:
      // resolve the same structured spawnError shape the async path produces so
      // an IPC caller can't turn this into an unhandled rejection.
      const spawnError = err instanceof Error ? err : new Error(String(err));
      resolve({
        stdout,
        stderr,
        exitCode: -1,
        executionTime: Date.now() - start,
        timedOut,
        killed,
        spawnError,
      });
      return;
    }

    const terminate = (reason: 'timeout' | 'stopped') => {
      if (resolved) return;
      if (reason === 'timeout') {
        timedOut = true;
      } else {
        killed = true;
      }
      killProcessTree(child, 'SIGTERM');
      if (escalationTimer === null) {
        escalationTimer = setTimeout(() => {
          killProcessTree(child, 'SIGKILL');
        }, killEscalationMs);
      }
    };

    const onAbort = () => terminate('stopped');
    if (signal) {
      if (signal.aborted) {
        terminate('stopped');
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    // Stdin forwarding (opt-in). Empty / undefined closes immediately so
    // user code that reads stdin without an end handler hits EOF on first
    // read.
    //
    // The write/end below is wrapped in try/catch for the SYNCHRONOUS
    // already-destroyed case, but an EPIPE from a child that exits while
    // the buffer flushes is delivered ASYNCHRONOUSLY as a stream 'error'
    // event — without this listener it becomes an uncaught exception that
    // crashes the main process. Best-effort stdin: the child not reading
    // it is a normal outcome, never an error.
    if (stdin) {
      child.stdin.on('error', () => {
        // EPIPE / ERR_STREAM_DESTROYED — child exited before consuming stdin.
      });
      try {
        if (stdin.data && stdin.data.length > 0) {
          child.stdin.write(stdin.data);
        }
        if (stdin.keepOpen) {
          // F-7 — leave stdin open for later interactive writes; hand the
          // stream to the caller, which owns closing it (e.g. a stdin-close
          // IPC or the run finishing).
          stdin.onStream?.(child.stdin);
        } else {
          child.stdin.end();
        }
      } catch {
        // stdin may already be closed if the child crashed during boot —
        // safe to ignore.
      }
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutTruncated) return;
      const text = chunk.toString();
      onStdout?.(text);
      stdout += text;
      if (stdout.length > maxOutputBytes) {
        stdout = truncateBytes(stdout, maxOutputBytes, stdoutTruncationMarker);
        stdoutTruncated = true;
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrTruncated) return;
      const text = chunk.toString();
      onStderr?.(text);
      stderr += text;
      if (stderr.length > maxOutputBytes) {
        stderr = truncateBytes(stderr, maxOutputBytes, stderrTruncationMarker);
        stderrTruncated = true;
      }
    });

    // Parent-owned timeout. Mirrors RL-078's pattern for the worker
    // runners — main owns the kill timer; the subprocess never schedules
    // its own.
    const killTimer: NodeJS.Timeout = setTimeout(() => {
      terminate('timeout');
    }, timeoutMs);

    const finish = (result: SpawnNativeRunResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(killTimer);
      if (escalationTimer !== null) clearTimeout(escalationTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(result);
    };

    child.on('close', (code: number | null) => {
      finish({
        stdout,
        stderr,
        exitCode: code ?? -1,
        executionTime: Date.now() - start,
        timedOut,
        killed,
      });
    });

    child.on('error', (err: Error) => {
      // `error` fires on spawn failure (e.g. ENOENT when the binary is
      // not on PATH). Surface the raw error so callers classify it into
      // their own `missing-binary` / error shape + copy.
      finish({
        stdout,
        stderr,
        exitCode: -1,
        executionTime: Date.now() - start,
        timedOut,
        killed,
        spawnError: err,
      });
    });
  });
}
