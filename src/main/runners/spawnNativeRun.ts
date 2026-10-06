/**
 * Shared native-run machinery for the desktop language runners.
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
 *     not exited; if it exits first, force-stop remaining descendants.
 *   - Optional user-driven abort (Stop button) via an `AbortSignal`,
 *     using the same SIGTERM→SIGKILL escalation.
 *   - stdout / stderr each accumulated and capped at `maxOutputBytes`
 *     including the UTF-8-bounded caller-supplied truncation markers.
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
import { NATIVE_RUN_OWNER_GONE, trackNativeRunProcess } from './nativeRunLifecycle';
import { utf8ByteLength } from '../../shared/utf8';
import { truncateNativeOutputUtf8 } from './nativeOutputUtf8';
import { detachedSpawnOptions, killProcessTree } from './processTree';
import { createUtf8ChunkDecoder } from './utf8Chunks';

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
  /** UTF-8 byte cap per captured stdout / stderr, including any marker. */
  maxOutputBytes: number;
  /** Marker appended when stdout is clipped; shortened safely if it exceeds the cap. */
  stdoutTruncationMarker: string;
  /** Marker appended when stderr is clipped; shortened safely if it exceeds the cap. */
  stderrTruncationMarker: string;
  /**
   * Opt into stdin management. When set, the helper attaches the async
   * EPIPE guard, writes `stdin.data` (when non-empty), and closes the
   * stream so the child hits EOF on first read. Omit it entirely to
   * leave the child's stdin untouched (Rust's posture).
   *
   * Interactive mode: when `keepOpen` is true the helper writes `data`
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

  // A cancelled preparation must not briefly create a process: even a child
  // immediately killed afterwards could already have performed user effects.
  if (signal?.aborted) {
    return Promise.resolve({
      stdout: '',
      stderr: '',
      exitCode: -1,
      executionTime: 0,
      timedOut: false,
      killed: true,
    });
  }

  return new Promise<SpawnNativeRunResult>((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let resolved = false;
    let timedOut = false;
    let killed = false;
    let exited = false;
    let exitCode: number | null = null;
    let escalationTimer: NodeJS.Timeout | null = null;
    let exitGraceTimer: NodeJS.Timeout | null = null;

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

    const releaseChild = trackNativeRunProcess(child, signal);
    const terminate = (reason: 'timeout' | 'stopped') => {
      if (resolved) return;
      if (reason === 'timeout') {
        timedOut = true;
      } else {
        killed = true;
      }
      // An owner that no longer exists cannot resume or observe graceful exit.
      if (reason === 'stopped' && signal?.reason === NATIVE_RUN_OWNER_GONE) {
        killProcessTree(child, 'SIGKILL');
      } else {
        killProcessTree(child, 'SIGTERM');
        if (escalationTimer === null) {
          escalationTimer = setTimeout(() => {
            killProcessTree(child, 'SIGKILL');
          }, killEscalationMs);
        }
      }
      if (exited) scheduleFinishAfterExit();
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
          // Leave stdin open for later interactive writes; hand the
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

    // Once a stream hits the cap the parent must stop RECEIVING, not just
    // stop accumulating: a child that keeps streaming hundreds of MB would
    // otherwise be Buffer-decoded chunk-by-chunk until exit/timeout. On
    // truncation, detach the handler and resume() so the pipe drains
    // straight to the void. destroy() is deliberately avoided — closing
    // the pipe can EPIPE a still-writing child and change its behavior;
    // the run contract (child lives until exit/timeout) stays intact.
    const decodeStdout = createUtf8ChunkDecoder();
    const decodeStderr = createUtf8ChunkDecoder();
    const onStdoutData = (chunk: Buffer) => {
      if (stdoutTruncated) return;
      const text = decodeStdout(chunk);
      onStdout?.(text);
      stdout += text;
      // The streaming Buffer decoder emits complete code points. Count only
      // the new decoded text rather than re-encoding the growing capture.
      stdoutBytes += utf8ByteLength(text);
      if (stdoutBytes > maxOutputBytes) {
        stdout = truncateNativeOutputUtf8(stdout, maxOutputBytes, stdoutTruncationMarker);
        stdoutTruncated = true;
        child.stdout.off('data', onStdoutData);
        child.stdout.resume();
      }
    };
    child.stdout.on('data', onStdoutData);

    const onStderrData = (chunk: Buffer) => {
      if (stderrTruncated) return;
      const text = decodeStderr(chunk);
      onStderr?.(text);
      stderr += text;
      stderrBytes += utf8ByteLength(text);
      if (stderrBytes > maxOutputBytes) {
        stderr = truncateNativeOutputUtf8(stderr, maxOutputBytes, stderrTruncationMarker);
        stderrTruncated = true;
        child.stderr.off('data', onStderrData);
        child.stderr.resume();
      }
    };
    child.stderr.on('data', onStderrData);

    // Parent-owned timeout. Mirrors the renderer's pattern for the worker
    // runners — main owns the kill timer; the subprocess never schedules
    // its own.
    const killTimer: NodeJS.Timeout = setTimeout(() => {
      terminate('timeout');
    }, timeoutMs);

    const finish = (result: SpawnNativeRunResult) => {
      if (resolved) return;
      resolved = true;
      // Parent close does not imply tree exit: descendants may own independent
      // pipes and ignore TERM. Finish cancellation before releasing ownership
      // or clearing escalation; normal completion keeps its existing behavior.
      if (killed || timedOut) killProcessTree(child, 'SIGKILL');
      releaseChild();
      clearTimeout(killTimer);
      if (escalationTimer !== null) clearTimeout(escalationTimer);
      if (exitGraceTimer !== null) clearTimeout(exitGraceTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(result);
    };

    // 'close' waits for every stdio holder, and a descendant that escaped the
    // tree kill (setsid, or any survivor on Windows) can hold the pipes forever.
    // A killed run therefore settles shortly after the direct child exits.
    function scheduleFinishAfterExit(): void {
      if (resolved || exitGraceTimer !== null) return;
      exitGraceTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish({
          stdout,
          stderr,
          exitCode: exitCode ?? -1,
          executionTime: Date.now() - start,
          timedOut,
          killed,
        });
      }, killEscalationMs);
    }

    child.on('exit', (code: number | null) => {
      exited = true;
      exitCode = code;
      if (killed || timedOut) scheduleFinishAfterExit();
    });

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
