/**
 * internal — Shared resource limits + truncation helpers for the
 * JavaScript / TypeScript / Python runners.
 *
 * The runner stack used to rely on a `setTimeout` scheduled INSIDE the
 * worker as the only line of defense against runaway code. A
 * CPU-bound `while (true) {}` body never yields the worker's event
 * loop, so the timer never fires and the UI hangs until the user
 * clicks Stop.
 *
 * internal moves the kill timer to the parent renderer thread (the only
 * thread still responsive when the worker is wedged) and adds these
 * caps so a non-infinite-but-busy run cannot flood the IPC channel,
 * the console panel, or the result panel.
 *
 * Caps are intentionally per-run and per-payload, not per-second:
 * we drop late entries past the budget rather than throttle, which
 * keeps the implementation deterministic and easy to reason about.
 */
import type {
  ConsoleOutput,
  ExecutionError,
  ExecutionResult,
  RuntimeTimeoutPreset,
} from '../types';

// internal: re-export the main-side native subprocess caps so renderer
// surfaces stay co-located and a future bump can update both worker
// and subprocess heaps in lockstep. The renderer caps below are
// intentionally tighter (worker heap shares with the UI thread); see
// the comment in `src/shared/runnerLimits.ts` for the asymmetry.
export {
  MAX_NATIVE_STDERR_BYTES,
  MAX_COMPILE_OUTPUT_BYTES,
  truncateBytes,
} from '../../shared/runnerLimits';

/** Entries kept per stdout or stderr stream, including the truncation marker. */
export const MAX_CONSOLE_ENTRIES = 1000;

/** Aggregate cap on stderr text bytes (UTF-16 code units). */
export const MAX_STDERR_BYTES = 256 * 1024;

/** Cap on serialized result + magic-comment payloads. */
export const MAX_RESULT_BYTES = 64 * 1024;

/**
 * Translation lookup the renderer modules already use. Tests and
 * fixtures pass a stub directly so the helpers stay decoupled from
 * the i18n runtime.
 */
export type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/**
 * Append `output` to `entries` unless the per-stream cap has already
 * been reached. The first dropped entry is replaced with a
 * synthetic console entry carrying the localized truncation notice
 * so the user sees exactly when output was clipped; further drops
 * are silent. Returns the updated `dropped` counter so callers can
 * report a final tally if desired.
 *
 * The notice copy is intentionally count-agnostic: at the moment we
 * push it, zero further entries have been dropped (this IS the
 * first drop). Streaming an updated count later would mean
 * mutating an already-rendered console entry, which the renderer
 * does not support, so the marker stays a binary signal.
 */
export function appendCappedConsole(
  entries: ConsoleOutput[],
  output: ConsoleOutput,
  dropped: number,
  t: TranslateFn
): number {
  if (entries.length < MAX_CONSOLE_ENTRIES) {
    entries.push(output);
    return dropped;
  }
  if (dropped === 0) {
    entries[MAX_CONSOLE_ENTRIES - 1] = {
      type: 'warn',
      args: [t('runner.truncated.console')],
    };
  }
  return dropped + 1;
}

/**
 * Replace `stderr` once its aggregate byte length passes
 * `MAX_STDERR_BYTES` with a single localized truncation marker.
 * Mutates the array in place and returns whether a truncation
 * happened so callers can avoid further appends.
 */
export function capStderrIfOverflowing(
  stderr: ConsoleOutput[],
  t: TranslateFn
): boolean {
  let total = 0;
  for (const entry of stderr) {
    for (const arg of entry.args) total += arg.length;
    if (total > MAX_STDERR_BYTES) break;
  }
  if (total <= MAX_STDERR_BYTES) return false;
  stderr.length = 0;
  stderr.push({ type: 'error', args: [t('runner.truncated.stderr')] });
  return true;
}

/**
 * Truncate a serialized result / magic-comment value to fit in
 * `MAX_RESULT_BYTES`. Used by both workers' `serialize()` step.
 * Returns the input unchanged when it already fits.
 */
export function truncateSerialized(value: string, marker: string): string {
  if (value.length <= MAX_RESULT_BYTES) return value;
  // Reserve a few characters for the marker so the suffix is always
  // visible even on edge-case-tight budgets.
  const headroom = Math.max(1, MAX_RESULT_BYTES - marker.length);
  return `${value.slice(0, headroom)}${marker}`;
}

/**
 * Build the canonical "execution timed out" result the parent
 * runners resolve with when the kill timer fires. Centralizing the
 * shape here keeps the JS / TS / Python paths in lockstep and lets
 * tests assert the exact contract.
 */
export function runnerTimeoutResult(
  timeoutMs: number,
  t: TranslateFn,
  collected: { stdout: ConsoleOutput[]; stderr: ConsoleOutput[] },
  timeoutPreset?: RuntimeTimeoutPreset | 'override'
): ExecutionResult {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  // implementation note — point users at the Settings field they
  // need so the timed-out message becomes actionable. The hint copy
  // is appended only when the run did NOT come from an explicit
  // caller override; for one-shot extended runs and magic-comment
  // overrides the Settings field is not the place to adjust.
  const baseMessage = t('runner.timeout.message', { seconds });
  const message =
    timeoutPreset === 'override'
      ? baseMessage
      : `${baseMessage} ${t('runtime.timeout.hint.openSettings')}`;
  const error: ExecutionError = { message };
  return {
    stdout: collected.stdout,
    stderr: collected.stderr,
    result: undefined,
    executionTime: timeoutMs,
    error,
    // implementation — explicit kind + preset + duration so the
    // renderer's <RunStatusPill> renders the right variant + tooltip
    // without string-matching on `error.message`.
    kind: 'timeout',
    timeoutPreset,
    timeoutMs,
  };
}

/**
 * Build the canonical user-cancelled result used when `stop()`
 * terminates an in-flight worker. It is intentionally distinct from
 * success and timeout so manual Stop clicks do not record successful
 * history entries or paint the tab green.
 */
export function runnerStoppedResult(
  t: TranslateFn,
  collected: { stdout: ConsoleOutput[]; stderr: ConsoleOutput[] }
): ExecutionResult {
  return {
    stdout: collected.stdout,
    stderr: collected.stderr,
    result: undefined,
    executionTime: 0,
    cancelled: true,
    error: {
      message: t('runner.stopped.message'),
    },
    // implementation — explicit `'stopped'` kind so the renderer
    // can render the dedicated <RunStatusPill> variant instead of
    // re-deriving stop vs. timeout vs. error from `error.message`.
    kind: 'stopped',
  };
}
