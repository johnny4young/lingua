/**
 * implementation — coverage for the Go / Rust stdout splitter
 * that enriches `ConsoleOutput.line` with `file.ext:N` references.
 */

import { describe, expect, it } from 'vitest';
import {
  enrichConsoleOutputLine,
  extractOriginFromGoStdout,
  extractOriginFromRustStdout,
} from '../../../src/renderer/runners/originSplitter';

// Backtracking risk = CPU seconds. Measure process CPU rather than wall
// time so host scheduling pressure cannot impersonate regex work.
// Tightening below 250 ms misses no meaningful signal: multi-second CPU
// backtracking is the regression this guard is designed to catch.
const REDOS_BUDGET_MS = 250;

function createElapsedTimer(): () => number {
  const start = process.cpuUsage();
  return () => {
    const elapsed = process.cpuUsage(start);
    return (elapsed.user + elapsed.system) / 1_000;
  };
}

describe('extractOriginFromGoStdout', () => {
  it('captures the first `file.go:N` reference', () => {
    expect(extractOriginFromGoStdout('runtime.go:42')).toEqual({
      file: 'runtime.go',
      line: 42,
    });
  });

  it('handles paths with subdirectories and dashes', () => {
    expect(extractOriginFromGoStdout('pkg/foo-bar/baz.go:123 panic: x')).toEqual(
      { file: 'pkg/foo-bar/baz.go', line: 123 }
    );
  });

  it('returns undefined when no go file is referenced', () => {
    expect(extractOriginFromGoStdout('panic: bang')).toBeUndefined();
    expect(extractOriginFromGoStdout('main.rs:8')).toBeUndefined();
    expect(extractOriginFromGoStdout('')).toBeUndefined();
  });

  it('rejects bogus or unbounded line numbers', () => {
    expect(extractOriginFromGoStdout('foo.go:0')).toBeUndefined();
    expect(extractOriginFromGoStdout('foo.go:9999999')).toBeUndefined();
  });
});

describe('extractOriginFromRustStdout', () => {
  it('captures the first `file.rs:N` reference', () => {
    expect(
      extractOriginFromRustStdout("panicked at 'foo', src/main.rs:8")
    ).toEqual({ file: 'src/main.rs', line: 8 });
  });

  it('returns undefined when no rs file is referenced', () => {
    expect(extractOriginFromRustStdout('main.go:8')).toBeUndefined();
    expect(extractOriginFromRustStdout('')).toBeUndefined();
  });
});

describe('enrichConsoleOutputLine', () => {
  it('preserves an existing line value when provided', () => {
    expect(enrichConsoleOutputLine('go', 12, ['runtime.go:42'])).toBe(12);
  });

  it('returns undefined for empty args without a fallback', () => {
    expect(enrichConsoleOutputLine('go', undefined, [])).toBeUndefined();
    expect(enrichConsoleOutputLine('go', undefined, undefined)).toBeUndefined();
  });

  it('joins multi-arg messages before applying the splitter', () => {
    expect(
      enrichConsoleOutputLine('rust', undefined, ['panicked at', 'src/main.rs:8'])
    ).toBe(8);
  });

  it('routes language-specific patterns through the correct splitter', () => {
    expect(enrichConsoleOutputLine('go', undefined, ['main.rs:8'])).toBeUndefined();
    expect(enrichConsoleOutputLine('rust', undefined, ['main.go:8'])).toBeUndefined();
  });
});

// Regression coverage: the path character class must stay linear on
// hostile no-match stdout chunks. Dropping `.` from the class and
// capping scan length prevents future regex tweaks from reintroducing
// catastrophic backtracking.
describe('originSplitter — ReDoS resistance', () => {
  it('returns quickly for a long no-match string of dots (Go)', () => {
    const hostile = '.'.repeat(50_000);
    const elapsed = createElapsedTimer();
    expect(extractOriginFromGoStdout(hostile)).toBeUndefined();
    expect(elapsed()).toBeLessThan(REDOS_BUDGET_MS);
  });

  it('returns quickly for a long no-match string of slashes (Rust)', () => {
    const hostile = '/'.repeat(50_000);
    const elapsed = createElapsedTimer();
    expect(extractOriginFromRustStdout(hostile)).toBeUndefined();
    expect(elapsed()).toBeLessThan(REDOS_BUDGET_MS);
  });

  it('truncates scan input to MAX_SCAN_BYTES = 4096 chars', () => {
    const head = '#'.repeat(5_000);
    const tail = 'main.go:42';
    // Match buried past the cap should NOT trigger — the splitter
    // never sees it.
    expect(extractOriginFromGoStdout(head + tail)).toBeUndefined();
  });

  it('still finds a match inside the scan window', () => {
    const filler = '#'.repeat(100);
    expect(extractOriginFromGoStdout(filler + 'main.go:7')).toEqual({
      file: 'main.go',
      line: 7,
    });
  });
});
