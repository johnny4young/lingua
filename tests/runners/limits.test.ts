/**
 * internal — limits.ts unit tests.
 *
 * Pin the truncation contract for the runner output caps so the
 * renderer's console / result panels never ingest unbounded
 * payloads. The helpers are pure functions; we drive them with a
 * stub translator so the assertions don't depend on the i18n
 * runtime.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_CONSOLE_ENTRIES,
  MAX_RESULT_BYTES,
  MAX_STDERR_BYTES,
  appendCappedConsole,
  capStderrIfOverflowing,
  runnerStoppedResult,
  runnerTimeoutResult,
  truncateSerialized,
  type TranslateFn,
} from '@/runners/limits';
import type { ConsoleOutput } from '@/types';

const t: TranslateFn = (key, options) => {
  if (!options) return key;
  const formatted = Object.entries(options)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(',');
  return `${key}{${formatted}}`;
};

function makeEntry(text: string): ConsoleOutput {
  return { type: 'log', args: [text] };
}

describe('appendCappedConsole', () => {
  it('appends entries below the budget without altering them', () => {
    const entries: ConsoleOutput[] = [];
    let dropped = 0;
    for (let i = 0; i < 5; i += 1) {
      dropped = appendCappedConsole(entries, makeEntry(`line-${i}`), dropped, t);
    }
    expect(entries).toHaveLength(5);
    expect(dropped).toBe(0);
  });

  it('emits a single localized truncation notice once the cap is hit', () => {
    const entries: ConsoleOutput[] = [];
    let dropped = 0;
    for (let i = 0; i < MAX_CONSOLE_ENTRIES + 5; i += 1) {
      dropped = appendCappedConsole(entries, makeEntry('x'), dropped, t);
    }
    // MAX entries total, with the final retained slot converted
    // into the synthetic notice.
    expect(entries).toHaveLength(MAX_CONSOLE_ENTRIES);
    expect(entries[MAX_CONSOLE_ENTRIES - 1]?.type).toBe('warn');
    // Notice key has no interpolation (binary signal), so the stub
    // returns the bare key.
    expect(entries[MAX_CONSOLE_ENTRIES - 1]?.args[0]).toBe(
      'runner.truncated.console'
    );
    expect(dropped).toBe(5);
  });
});

describe('capStderrIfOverflowing', () => {
  it('returns false when total stderr fits in the budget', () => {
    const stderr: ConsoleOutput[] = [
      { type: 'error', args: ['short'] },
    ];
    expect(capStderrIfOverflowing(stderr, t)).toBe(false);
    expect(stderr).toHaveLength(1);
  });

  it('replaces stderr with a single truncation notice once overflowed', () => {
    const huge = 'x'.repeat(MAX_STDERR_BYTES + 1);
    const stderr: ConsoleOutput[] = [{ type: 'error', args: [huge] }];
    expect(capStderrIfOverflowing(stderr, t)).toBe(true);
    expect(stderr).toEqual([
      { type: 'error', args: ['runner.truncated.stderr'] },
    ]);
  });
});

describe('truncateSerialized', () => {
  it('returns the input unchanged when under the cap', () => {
    expect(truncateSerialized('hello', '… [trunc]')).toBe('hello');
  });

  it('appends the marker when the value exceeds MAX_RESULT_BYTES', () => {
    const marker = '… [result truncated]';
    const value = 'x'.repeat(MAX_RESULT_BYTES + 100);
    const truncated = truncateSerialized(value, marker);
    expect(truncated.endsWith(marker)).toBe(true);
    expect(truncated.length).toBe(MAX_RESULT_BYTES);
  });
});

describe('runnerTimeoutResult', () => {
  it('builds a deterministic timeout-shaped ExecutionResult with translated copy', () => {
    const stdout: ConsoleOutput[] = [{ type: 'log', args: ['before stall'] }];
    const stderr: ConsoleOutput[] = [];
    // implementation note — the timeout result appends the
    // "open Settings" hint when the run used a Settings-driven
    // preset (not an explicit caller override). The 4th arg is
    // omitted here, which is treated like the preset path.
    const result = runnerTimeoutResult(3_000, t, { stdout, stderr });
    expect(result.error?.message).toBe(
      'runner.timeout.message{seconds=3} runtime.timeout.hint.openSettings'
    );
    expect(result.executionTime).toBe(3_000);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe(stderr);
    expect(result.result).toBeUndefined();
    // implementation — explicit kind + duration carried on the
    // result so the renderer pill self-gates without regex.
    expect(result.kind).toBe('timeout');
    expect(result.timeoutMs).toBe(3_000);
  });

  it('rounds sub-second timeouts up to a 1-second floor for display', () => {
    const result = runnerTimeoutResult(250, t, { stdout: [], stderr: [] });
    expect(result.error?.message).toBe(
      'runner.timeout.message{seconds=1} runtime.timeout.hint.openSettings'
    );
  });

  it('drops the Settings hint when the run used an explicit override', () => {
    const result = runnerTimeoutResult(
      90_000,
      t,
      { stdout: [], stderr: [] },
      'override'
    );
    // No hint suffix when the run was driven by an explicit
    // caller-supplied timeout (one-shot extended, magic-comment).
    expect(result.error?.message).toBe('runner.timeout.message{seconds=90}');
    expect(result.timeoutPreset).toBe('override');
  });
});

describe('runnerStoppedResult', () => {
  it('marks user-stopped executions as cancelled, not successful', () => {
    const result = runnerStoppedResult(t, { stdout: [], stderr: [] });
    expect(result.cancelled).toBe(true);
    expect(result.error?.message).toBe('runner.stopped.message');
    expect(result.executionTime).toBe(0);
  });
});
