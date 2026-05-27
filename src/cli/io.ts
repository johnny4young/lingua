/**
 * RL-098 Slice 1 — IO seams.
 *
 * Thin wrappers around `fs/promises`, `process.stdin`, and the two
 * write streams. The CLI commands depend on the `CliIo` interface
 * (not directly on `process`) so unit tests can swap in fakes
 * without spawning a real subprocess.
 *
 * `readStdin()` resolves when stdin closes. It returns `null` when
 * stdin is a TTY and no data has been piped — the caller turns that
 * into a usage error rather than hanging forever waiting on input.
 */

import { readFile } from 'node:fs/promises';

export interface CliIo {
  /** Print to stdout. No trailing newline added — caller controls it. */
  writeStdout(text: string): void;
  /** Print to stderr. No trailing newline added — caller controls it. */
  writeStderr(text: string): void;
  /** Read the full contents of a file as UTF-8. */
  readFile(path: string): Promise<string>;
  /**
   * Read stdin to completion. Returns `null` when stdin is a TTY
   * (i.e. no data is being piped) so the CLI can refuse to hang on
   * an interactive shell. Returns `''` when stdin is piped but
   * empty.
   */
  readStdin(): Promise<string | null>;
}

export function createDefaultIo(): CliIo {
  return {
    writeStdout(text) {
      process.stdout.write(text);
    },
    writeStderr(text) {
      process.stderr.write(text);
    },
    async readFile(path) {
      return readFile(path, 'utf8');
    },
    async readStdin() {
      // `process.stdin.isTTY` is `true` only when the stream is
      // attached to an interactive terminal — no pipe, no redirect.
      // Reading from a TTY would block forever waiting for the user
      // to type + send EOF, which is never what a CI script wants.
      if (process.stdin.isTTY) {
        return null;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString('utf8');
    },
  };
}
