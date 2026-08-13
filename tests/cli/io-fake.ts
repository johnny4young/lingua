/**
 * implementation — in-memory CLI IO seam for tests.
 *
 * Replaces `createDefaultIo()` so we can drive the dispatcher and
 * command handlers without spawning a subprocess. The fake captures
 * everything written to stdout / stderr and lets the test seed
 * stdin + a virtual filesystem.
 */

import type { CliIo } from '../../src/cli/io';

export interface FakeIoState {
  stdout: string;
  stderr: string;
  prompts: string[];
}

export interface FakeIoOptions {
  stdin?: string | null;
  files?: Record<string, string>;
  /** Throws on readFile to exercise ENOENT etc. */
  readFileError?: NodeJS.ErrnoException;
  stdoutSupportsColor?: boolean;
  stderrSupportsColor?: boolean;
  environment?: Readonly<Record<string, string | undefined>>;
  confirm?: boolean | null;
}

export function createFakeIo(options: FakeIoOptions = {}): { io: CliIo; state: FakeIoState } {
  const state: FakeIoState = { stdout: '', stderr: '', prompts: [] };
  const io: CliIo = {
    stdoutSupportsColor: options.stdoutSupportsColor ?? false,
    stderrSupportsColor: options.stderrSupportsColor ?? false,
    getEnvironmentValue(name) {
      return options.environment?.[name];
    },
    async confirm(message) {
      state.prompts.push(message);
      return options.confirm ?? null;
    },
    writeStdout(text) {
      state.stdout += text;
    },
    writeStderr(text) {
      state.stderr += text;
    },
    async readFile(path) {
      if (options.readFileError) {
        throw options.readFileError;
      }
      const entry = options.files?.[path];
      if (entry === undefined) {
        const err = new Error(
          `ENOENT: no such file or directory, open '${path}'`
        ) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return entry;
    },
    async readStdin() {
      return options.stdin ?? null;
    },
  };
  return { io, state };
}
