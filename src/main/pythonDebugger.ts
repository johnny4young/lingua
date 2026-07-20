/**
 * implementation — main-process Python debugger bridge (engine).
 *
 * Lingua *runs* Python in Pyodide (WASM, in the renderer worker), but a
 * source-level debugger needs a real interpreter with `pdb`. This module is
 * the desktop-only engine that drives a headless `python -u -m pdb <script>`
 * subprocess: the renderer will send breakpoint / step / continue / evaluate
 * commands and receive structured pause events (file + line + locals). It is
 * the Python parallel of the JS/TS instrumentation debugger, per
 * `docs/DEBUGGER_ADR.md` (§Python, second slice).
 *
 * Scope of this change: the process-management + `pdb`-REPL protocol engine,
 * with real-`pdb` integration tests. The `debugger:python:*` IPC contract +
 * preload bridge + the renderer debugger UI (breakpoint gutter, variables
 * panel, step toolbar) are the following slice — this engine is designed to
 * sit behind a thin IPC marshaling layer exactly like `src/main/git.ts`.
 *
 * Protocol notes (captured from CPython 3.11 `pdb`):
 *   - `pdb` prints a stop as two lines:
 *       `> <file>(<line>)<func>()`
 *       `-> <source line>`
 *     followed by the prompt `(Pdb) ` — SIX chars, NO trailing newline. The
 *     prompt is the "ready for the next command" delimiter, so the engine
 *     treats "stdout buffer ends with `(Pdb) `" as command-complete.
 *   - `b <line>` sets a breakpoint (`Breakpoint N at <file>:<line>`), `c`
 *     continues, `n` steps over, `s` steps into, `r` runs to return, `p
 *     <expr>` prints a value, `q` quits.
 *   - When the program ends, `pdb` prints
 *     `The program finished and will be restarted` and loops back to line 1.
 *     The engine treats that marker as terminal and quits instead of looping.
 *
 * Safety: `spawn` with `shell: false` and an argv array — user source travels
 * as a file path, never interpolated into a shell string. Commands are
 * serialized (one in flight at a time) so replies map unambiguously to
 * requests.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { detachedSpawnOptions, killProcessTree } from './runners/processTree';

/** The `(Pdb) ` prompt CPython emits when ready for the next command. */
const PDB_PROMPT = '(Pdb) ';
/** Marker `pdb` prints when the debugged program runs to completion. */
const PROGRAM_FINISHED_MARKER = 'The program finished and will be restarted';

/** Default per-command timeout — a command that never returns a prompt. */
export const DEFAULT_PDB_COMMAND_TIMEOUT_MS = 15_000;

/** Grace window after SIGTERM before escalating terminate() to SIGKILL. */
const KILL_ESCALATION_DELAY_MS = 1_500;

export interface PdbLocation {
  /** Absolute path of the file the interpreter is paused in. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** Enclosing function name (`<module>` at top level). */
  func: string;
  /** The source text of the paused line (from pdb's `-> ` line), if present. */
  sourceLine?: string;
}

export interface PdbCommandResult {
  /** Raw pdb/program text emitted while processing the command (prompt stripped). */
  output: string;
  /** Parsed current stop location, or `null` when the command produced none. */
  location: PdbLocation | null;
  /** True once the debugged program has run to completion. */
  finished: boolean;
}

export type PdbEventListener = (event: PdbSessionEvent) => void;
export type PdbSessionEvent =
  | { readonly kind: 'paused'; readonly location: PdbLocation }
  | { readonly kind: 'finished' }
  | { readonly kind: 'exited'; readonly code: number | null };

/** `spawn`-compatible seam so tests can inject a fake process. */
export type SpawnPdb = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv }
) => ChildProcessWithoutNullStreams;

export interface PythonDebugSessionOptions {
  /** Absolute path of the `.py` script to debug. */
  scriptPath: string;
  /** Python executable. Defaults to `python3`. */
  pythonPath?: string;
  /** Working directory for the subprocess. */
  cwd?: string;
  /** Environment for the subprocess (already sanitized by the caller). */
  env?: NodeJS.ProcessEnv;
  /** Extra argv passed to the debugged program (after the script path). */
  programArgs?: readonly string[];
  /** Per-command timeout. Defaults to `DEFAULT_PDB_COMMAND_TIMEOUT_MS`. */
  commandTimeoutMs?: number;
  /** Test seam: inject a fake `spawn`. Production omits it. */
  spawnImpl?: SpawnPdb;
}

/** Parse a `> file(line)func()` stop line + its optional `-> source` follow-up. */
export function parsePdbLocation(text: string): PdbLocation | null {
  const lines = text.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^> (.+)\((\d+)\)([^()]*)\(\)/u.exec(lines[i]!);
    if (!match) continue;
    const file = match[1]!;
    const line = Number(match[2]);
    const func = match[3]!.length > 0 ? match[3]! : '<module>';
    const location: PdbLocation = { file, line, func };
    const next = lines[i + 1];
    if (typeof next === 'string' && next.startsWith('-> ')) {
      location.sourceLine = next.slice(3);
    }
    return location;
  }
  return null;
}

/**
 * A live `pdb` session. Commands are serialized: each resolves when `pdb`
 * re-emits its prompt. Always dispose with `terminate()`.
 */
export class PythonDebugSession {
  private readonly options: Required<
    Pick<PythonDebugSessionOptions, 'scriptPath' | 'pythonPath' | 'commandTimeoutMs'>
  > &
    PythonDebugSessionOptions;
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  /**
   * Settles the in-flight command's prompt wait, if any. Called with no
   * argument to resolve on a prompt (or exit), or with an Error to reject —
   * e.g. a spawn failure the wait should surface instead of hanging.
   */
  private pendingPrompt: ((error?: Error) => void) | null = null;
  private readonly listeners = new Set<PdbEventListener>();
  private exited = false;
  private exitCode: number | null = null;
  /** A spawn / process-level error (e.g. missing python), surfaced to waiters. */
  private processError: Error | null = null;
  /** True once the debugged program ran to completion (a terminal state). */
  private finished = false;
  /** Pending SIGTERM→SIGKILL escalation timer, if armed. */
  private killEscalationTimer: NodeJS.Timeout | null = null;
  /** Serialize commands so replies map to requests unambiguously. */
  private queue: Promise<unknown> = Promise.resolve();
  /**
   * Maps a source line to the breakpoint number pdb assigned when it was set.
   * `clear` by number is path-independent — pdb canonicalizes file paths
   * (macOS resolves `/var`→`/private/var`, symlinks, `..`), so a
   * `clear <file>:<line>` built from the caller's raw path can miss the very
   * breakpoint `b <line>` created against pdb's canonical path.
   */
  private readonly breakpointNumbers = new Map<number, number>();

  constructor(options: PythonDebugSessionOptions) {
    this.options = {
      pythonPath: 'python3',
      commandTimeoutMs: DEFAULT_PDB_COMMAND_TIMEOUT_MS,
      ...options,
    };
  }

  /** Subscribe to paused / finished / exited events. Returns an unsubscribe. */
  on(listener: PdbEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: PdbSessionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* a listener throwing must not break the session */
      }
    }
  }

  /**
   * Spawn `python -u -m pdb <script> [args…]` and wait for the first prompt.
   * Resolves with the initial pause (top of the module).
   */
  async start(): Promise<PdbCommandResult> {
    if (this.child) throw new Error('Debug session already started');
    const spawnImpl = this.options.spawnImpl ?? defaultSpawn;
    const args = [
      '-u',
      '-m',
      'pdb',
      this.options.scriptPath,
      ...(this.options.programArgs ?? []),
    ];
    const child = spawnImpl(this.options.pythonPath, args, {
      cwd: this.options.cwd,
      env: this.options.env,
    });
    this.child = child;

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => this.onData(chunk));
    // pdb writes its prompt + most output to stdout; stderr carries the
    // debugged program's stderr, which we surface as output too.
    child.stderr.on('data', (chunk: string) => this.onData(chunk));
    // An EPIPE / ERR_STREAM_DESTROYED from a child that exits mid-write is
    // delivered asynchronously as a stream 'error' event; without a listener it
    // becomes an uncaught exception that crashes the main process. Mirrors
    // node-runner.ts / ruby-runner.ts. Best-effort stdin: the child not reading
    // it is a normal outcome, never an error.
    child.stdin.on('error', () => {
      // Child exited before consuming stdin — nothing to do.
    });
    // A spawn failure (e.g. `python3` not installed) surfaces here, NOT on
    // stdin. Without a 'error' listener it is an uncaught exception that crashes
    // Electron's main process; capture it and reject the pending start()/command
    // instead of leaving the caller to wait out the timeout.
    child.on('error', (err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.processError = error;
      this.exited = true;
      this.exitCode = null;
      const pending = this.pendingPrompt;
      this.pendingPrompt = null;
      pending?.(error);
      this.emit({ kind: 'exited', code: null });
    });
    child.on('exit', (code) => {
      // Skip a duplicate 'exited' if the 'error' handler (or a terminal
      // finished/timeout path) already flipped `exited` and emitted.
      const shouldEmit = !this.exited;
      this.exited = true;
      this.exitCode = code;
      // A natural exit means the SIGKILL escalation is moot — drop the timer.
      if (this.killEscalationTimer) {
        clearTimeout(this.killEscalationTimer);
        this.killEscalationTimer = null;
      }
      // Unblock any waiter so a caller never hangs on a dead process.
      const pending = this.pendingPrompt;
      this.pendingPrompt = null;
      pending?.();
      if (shouldEmit) this.emit({ kind: 'exited', code });
    });

    return this.waitForPrompt();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    // Resolve only when the buffer ENDS with the prompt — a prompt mid-buffer
    // means more output is still streaming. (No `includes` scan: it added an
    // O(n) walk of the whole buffer on every chunk with no behavioral gain.)
    if (this.pendingPrompt && this.buffer.endsWith(PDB_PROMPT)) {
      const pending = this.pendingPrompt;
      this.pendingPrompt = null;
      pending();
    }
  }

  /** Wait for the next `(Pdb) ` prompt, then snapshot + reset the buffer. */
  private waitForPrompt(): Promise<PdbCommandResult> {
    return new Promise<PdbCommandResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new Error(
          `pdb command timed out after ${this.options.commandTimeoutMs}ms`
        );
        // A command that never returns a prompt means the debugged program is
        // wedged (e.g. an infinite loop under `continue`). Tear the subprocess
        // down rather than leave it running behind a rejected command.
        this.processError = error;
        this.exited = true;
        this.pendingPrompt = null;
        this.killDebuggerProcess();
        reject(error);
      }, this.options.commandTimeoutMs);

      const settle = (error?: Error): void => {
        clearTimeout(timeout);
        if (error) {
          reject(error);
          return;
        }
        const raw = this.buffer;
        this.buffer = '';
        resolve(this.buildResult(raw));
      };

      // A spawn/process error already recorded takes precedence over any buffered
      // output — surface it instead of resolving an empty/partial result.
      if (this.processError) {
        settle(this.processError);
        return;
      }
      if (this.buffer.endsWith(PDB_PROMPT)) {
        settle();
        return;
      }
      if (this.exited) {
        settle();
        return;
      }
      this.pendingPrompt = settle;
    });
  }

  private buildResult(raw: string): PdbCommandResult {
    const withoutPrompt = raw.endsWith(PDB_PROMPT)
      ? raw.slice(0, -PDB_PROMPT.length)
      : raw;
    const finished = withoutPrompt.includes(PROGRAM_FINISHED_MARKER);
    // `finished` is terminal: pdb would loop back to line 1 and park at a
    // restart prompt, so there is no meaningful active pause to report and the
    // location is dropped. Tear the subprocess down rather than leave it parked.
    const location = finished ? null : parsePdbLocation(withoutPrompt);
    if (finished) {
      this.emit({ kind: 'finished' });
      this.closeFinishedSession();
    } else if (location) {
      this.emit({ kind: 'paused', location });
    }
    return { output: withoutPrompt.trimEnd(), location, finished };
  }

  /**
   * Program ran to completion. pdb would return to its prompt and restart the
   * target on the next `continue`; treat completion as terminal for the engine
   * so no restartable pdb process lingers behind a finished session. Listeners
   * are left intact so a subscriber still sees the natural `exited` event.
   */
  private closeFinishedSession(): void {
    const child = this.child;
    if (!child || this.exited) return;
    this.finished = true;
    this.exited = true;
    try {
      child.stdin.write('q\n');
    } catch {
      /* stdin already closed */
    }
    this.killDebuggerProcess();
  }

  /**
   * Fell the pdb process AND anything it spawned (user code may fork children),
   * SIGTERM now and escalate to SIGKILL after a grace window. See
   * `src/main/runners/processTree.ts`; the matching `detached` flag is set in
   * `defaultSpawn`. Idempotent — the escalation timer is armed at most once and
   * cleared by the 'exit' handler.
   */
  private killDebuggerProcess(): void {
    const child = this.child;
    if (!child) return;
    killProcessTree(child, 'SIGTERM');
    if (this.killEscalationTimer === null) {
      this.killEscalationTimer = setTimeout(() => {
        killProcessTree(child, 'SIGKILL');
      }, KILL_ESCALATION_DELAY_MS);
      this.killEscalationTimer.unref?.();
    }
  }

  /** Send a raw pdb command line and resolve when the next prompt returns. */
  sendCommand(command: string): Promise<PdbCommandResult> {
    const run = async (): Promise<PdbCommandResult> => {
      // A command must be a single line: the engine writes `${command}\n` and
      // waits for exactly one `(Pdb) ` prompt in reply. An embedded newline
      // would send two pdb commands (e.g. `p x\nc` runs `p x` then a real
      // `continue`) while only one prompt is awaited — desyncing every later
      // request/reply. Reject before writing rather than corrupt the session.
      // Validated ahead of the running check so it holds even before start().
      if (/[\r\n]/u.test(command)) {
        throw new Error('pdb command must be a single line (no newlines)');
      }
      const child = this.child;
      if (this.finished) {
        throw new Error('Debug session has finished');
      }
      if (!child || this.exited) {
        throw new Error('Debug session is not running');
      }
      const promptPromise = this.waitForPrompt();
      try {
        child.stdin.write(`${command}\n`);
      } catch (err) {
        // The subprocess died between the running-state check and this write.
        // Swallow the now-orphaned prompt wait (its timeout would otherwise
        // reject unhandled) and fail fast instead of waiting out the timeout.
        void promptPromise.catch(() => undefined);
        throw err instanceof Error ? err : new Error('Failed to write pdb command');
      }
      return promptPromise;
    };
    // Chain onto the queue so only one command is ever in flight.
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async setBreakpoint(line: number): Promise<PdbCommandResult> {
    const result = await this.sendCommand(`b ${line}`);
    // pdb acknowledges with `Breakpoint N at <canonical-file>:<line>`; capture N
    // so the breakpoint can later be cleared by number (path-independent).
    const match = /^Breakpoint (\d+) at /mu.exec(result.output);
    if (match) this.breakpointNumbers.set(line, Number(match[1]));
    return result;
  }
  async clearBreakpoint(line: number): Promise<PdbCommandResult> {
    const bpNumber = this.breakpointNumbers.get(line);
    // Clear by the assigned number when known (survives path canonicalization);
    // fall back to file:line only if the breakpoint wasn't set via this session.
    const target = bpNumber != null ? String(bpNumber) : `${this.options.scriptPath}:${line}`;
    const result = await this.sendCommand(`cl ${target}`);
    this.breakpointNumbers.delete(line);
    return result;
  }
  continue(): Promise<PdbCommandResult> {
    return this.sendCommand('c');
  }
  stepOver(): Promise<PdbCommandResult> {
    return this.sendCommand('n');
  }
  stepInto(): Promise<PdbCommandResult> {
    return this.sendCommand('s');
  }
  stepOut(): Promise<PdbCommandResult> {
    return this.sendCommand('r');
  }

  /** Evaluate an expression in the current frame (`p <expr>`), returning its text. */
  async evaluate(expression: string): Promise<string> {
    const result = await this.sendCommand(`p ${expression}`);
    return result.output;
  }

  get isRunning(): boolean {
    return this.child !== null && !this.exited;
  }
  get code(): number | null {
    return this.exitCode;
  }

  /** Quit pdb and kill the subprocess (and anything it spawned). Idempotent. */
  terminate(): void {
    const child = this.child;
    if (!child || this.exited) return;
    // Flip `exited` synchronously so a command issued right after terminate()
    // rejects with "not running" instead of racing the async 'exit' event.
    this.exited = true;
    const pending = this.pendingPrompt;
    this.pendingPrompt = null;
    pending?.();
    try {
      child.stdin.write('q\n');
    } catch {
      /* stdin already closed */
    }
    this.killDebuggerProcess();
    this.listeners.clear();
  }
}

const defaultSpawn: SpawnPdb = (command, args, options) =>
  spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    // Process-group leader on POSIX so terminate() can fell the whole tree
    // (user code that forks/spawns) via killProcessTree, not just the direct
    // pdb child. No-op on Windows. See src/main/runners/processTree.ts.
    ...detachedSpawnOptions(),
  });
