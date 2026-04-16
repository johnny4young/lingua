import { describe, expect, it } from 'vitest';
import {
  parseGoExecutionError,
  parseRustExecutionError,
  toExecutionDiagnostics,
} from '@/utils/executionDiagnostics';

describe('executionDiagnostics helpers', () => {
  it('parses Go compiler errors into normalized execution errors', () => {
    expect(
      parseGoExecutionError('./main.go:3:5: undefined: fmt\n./main.go:5:1: too many errors')
    ).toEqual({
      message: 'undefined: fmt',
      line: 3,
      column: 5,
    });
  });

  it('falls back to the primary line for unstructured Go failures', () => {
    expect(parseGoExecutionError('build cache is disabled by GOCACHE=off')).toEqual({
      message: 'build cache is disabled by GOCACHE=off',
    });
  });

  it('parses Rust compile errors with source location', () => {
    expect(
      parseRustExecutionError(
        [
          'error[E0425]: cannot find value `x` in this scope',
          ' --> main.rs:3:20',
          '  |',
          '3 |     println!("{}", x);',
          '  |                    ^^^^^ not found in this scope',
        ].join('\n')
      )
    ).toEqual({
      message: 'error[E0425]: cannot find value `x` in this scope',
      line: 3,
      column: 20,
      endColumn: 24,
    });
  });

  it('parses Rust runtime panics with source location', () => {
    expect(
      parseRustExecutionError(
        "thread 'main' panicked at 'boom', src/main.rs:8:14",
        'thread panic'
      )
    ).toEqual({
      message: 'thread panic',
      line: 8,
      column: 14,
    });
  });

  it('maps execution errors into editor diagnostics only when location exists', () => {
    expect(
      toExecutionDiagnostics('rust', {
        message: 'cannot find value `x` in this scope',
        line: 3,
        column: 20,
      })
    ).toEqual([
      {
        message: 'cannot find value `x` in this scope',
        line: 3,
        column: 20,
        endLine: undefined,
        endColumn: undefined,
        severity: 'error',
        source: 'rust',
      },
    ]);

    expect(toExecutionDiagnostics('go', { message: 'compile failed' })).toEqual([]);
  });
});
