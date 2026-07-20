/**
 * implementation — line-by-line stdin reader for the Pyodide worker,
 * extracted (python-worker-env.ts precedent) so the EOF semantics are
 * unit-testable without a Pyodide harness.
 *
 * Contract:
 *  - The staged panel buffer is split up front so per-`input()`
 *    consumption is O(1) and the consumed count stays observable for
 *    the implementation note summary reply.
 *  - `read()` returns the next line INCLUDING its terminating `\n`
 *    (Pyodide expects the chunk with the line terminator), or `null`
 *    at EOF. With an EMPTY buffer the first read is already EOF, so a
 *    bare `input()` raises a clean `EOFError: EOF when reading a line`
 *    in user code.
 *  - The reader is installed via `pyodide.setStdin` on EVERY run.
 *    Falling back to Pyodide's stock handler in a Worker would call
 *    `prompt()` — unavailable there — leaking a raw
 *    `ReferenceError: prompt is not defined` to the renderer console
 *    per read and surfacing OSError instead of the documented
 *    EOFError (caught live in the 2026-06-10 desktop validation).
 */

export interface PythonStdinReader {
  /** Next staged line including `\n`, or `null` once the buffer is drained. */
  read(): string | null;
  /** Lines handed to `input()` so far — drives the stdin-consumed reply. */
  consumedCount(): number;
  /** Total staged lines (0 for an empty / undefined buffer). */
  total: number;
}

export function createStdinLineReader(
  stdin: string | undefined
): PythonStdinReader {
  const lines =
    typeof stdin === 'string' && stdin.length > 0
      ? (() => {
          const parts = stdin.split('\n');
          // A trailing newline is a terminator, not an extra empty
          // answer — mirror POSIX line semantics.
          if (parts.length > 0 && parts[parts.length - 1] === '') {
            parts.pop();
          }
          return parts;
        })()
      : [];
  let cursor = 0;

  return {
    read: () => {
      if (cursor >= lines.length) return null;
      const value = lines[cursor]!;
      cursor += 1;
      return `${value}\n`;
    },
    consumedCount: () => cursor,
    total: lines.length,
  };
}
