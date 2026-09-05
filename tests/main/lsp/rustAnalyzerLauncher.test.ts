/**
 * implementation — `RustAnalyzerLauncher` detection contract.
 *
 * Most of the framing logic is covered by `lspProcess.test.ts`. Here we
 * pin the launcher-specific pieces:
 *   - `resolveRustAnalyzerBinary` returns the bare command when PATH
 *     lookup succeeds and falls back to `~/.cargo/bin/rust-analyzer`
 *     when PATH fails but the fallback exists.
 *   - `pathToFileUri` round-trips POSIX paths and spaces / Unicode.
 *   - Status transitions: missing surfaces with a recognisable reason.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

const execFileMock = vi.fn();
const accessMock = vi.fn();

vi.mock('node:child_process', async () => ({
  execFile: execFileMock,
  default: { execFile: execFileMock },
}));

vi.mock('node:fs/promises', async () => ({
  access: accessMock,
  default: { access: accessMock },
}));

beforeEach(() => {
  execFileMock.mockReset();
  accessMock.mockReset();
});

describe('pathToFileUri', () => {
  it('encodes a plain POSIX absolute path', async () => {
    const { pathToFileUri } = await import('../../../src/main/lsp/rustAnalyzerLauncher');
    expect(pathToFileUri('/Users/alice/code/rust')).toBe('file:///Users/alice/code/rust');
  });

  it('percent-encodes spaces and Unicode segments', async () => {
    const { pathToFileUri } = await import('../../../src/main/lsp/rustAnalyzerLauncher');
    expect(pathToFileUri('/Users/alice/Mi proyecto 🦀/src')).toBe(
      'file:///Users/alice/Mi%20proyecto%20%F0%9F%A6%80/src'
    );
  });

  it('produces the three-slash form for a Windows-style backslash path', async () => {
    const { pathToFileUri } = await import('../../../src/main/lsp/rustAnalyzerLauncher');
    expect(pathToFileUri('C:\\Users\\alice\\code')).toBe('file:///C:/Users/alice/code');
  });

  it('escapes # and ? out of the path segment', async () => {
    const { pathToFileUri } = await import('../../../src/main/lsp/rustAnalyzerLauncher');
    expect(pathToFileUri('/tmp/a#b?c')).toBe('file:///tmp/a%23b%3Fc');
  });
});

describe('resolveRustAnalyzerBinary', () => {
  it('returns command "rust-analyzer" when PATH lookup succeeds', async () => {
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: readonly string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string) => void
      ) => {
        cb(null, 'rust-analyzer 0.4.0\n');
      }
    );
    accessMock.mockRejectedValue(new Error('should not be called'));

    const { resolveRustAnalyzerBinary } = await import(
      '../../../src/main/lsp/rustAnalyzerLauncher'
    );
    const result = await resolveRustAnalyzerBinary();
    expect(result?.source).toBe('path');
    expect(result?.command).toMatch(/rust-analyzer/);
  });

  it('falls back to ~/.cargo/bin/rust-analyzer when PATH lookup fails', async () => {
    execFileMock
      .mockImplementationOnce(
        (
          _cmd: string,
          _args: readonly string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string) => void
        ) => {
          cb(new Error('ENOENT'), '');
        }
      )
      .mockImplementationOnce(
        (
          _cmd: string,
          _args: readonly string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string) => void
        ) => {
          cb(null, 'rust-analyzer 0.4.0\n');
        }
      );
    accessMock.mockResolvedValue(undefined);

    const { resolveRustAnalyzerBinary } = await import(
      '../../../src/main/lsp/rustAnalyzerLauncher'
    );
    const result = await resolveRustAnalyzerBinary();
    expect(result?.source).toBe('cargo-bin');
    expect(result?.command).toMatch(/\.cargo[\\/]+bin[\\/]+rust-analyzer/);
  });

  it('treats a rustup proxy without the rust-analyzer component as missing', async () => {
    execFileMock
      .mockImplementationOnce(
        (
          _cmd: string,
          _args: readonly string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string) => void
        ) => {
          cb(new Error('ENOENT'), '');
        }
      )
      .mockImplementationOnce(
        (
          _cmd: string,
          _args: readonly string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string) => void
        ) => {
          cb(new Error("Unknown binary 'rust-analyzer'"), '');
        }
      );
    accessMock.mockResolvedValue(undefined);

    const { resolveRustAnalyzerBinary } = await import(
      '../../../src/main/lsp/rustAnalyzerLauncher'
    );
    const result = await resolveRustAnalyzerBinary();
    expect(result).toBeNull();
  });

  it('returns null when neither PATH nor cargo-bin contains the binary', async () => {
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: readonly string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string) => void
      ) => {
        cb(new Error('ENOENT'), '');
      }
    );
    accessMock.mockRejectedValue(new Error('ENOENT'));

    const { resolveRustAnalyzerBinary } = await import(
      '../../../src/main/lsp/rustAnalyzerLauncher'
    );
    const result = await resolveRustAnalyzerBinary();
    expect(result).toBeNull();
  });
});

describe('RustAnalyzerLauncher initialize params', () => {
  it('does not default the workspace root to the user home directory', async () => {
    const { RustAnalyzerLauncher } = await import(
      '../../../src/main/lsp/rustAnalyzerLauncher'
    );
    const launcher = new RustAnalyzerLauncher() as unknown as {
      buildInitializeParams: () => Record<string, unknown>;
    };

    const params = launcher.buildInitializeParams();

    expect(params.rootUri).toBeNull();
    expect(params.workspaceFolders).toBeNull();
  });

  it('uses an explicit workspace root when one is supplied', async () => {
    const { RustAnalyzerLauncher } = await import(
      '../../../src/main/lsp/rustAnalyzerLauncher'
    );
    const launcher = new RustAnalyzerLauncher({
      workspaceRoot: '/Users/alice/code/rust-app',
    }) as unknown as {
      buildInitializeParams: () => Record<string, unknown>;
    };

    const params = launcher.buildInitializeParams();

    expect(params.rootUri).toBe('file:///Users/alice/code/rust-app');
    expect(params.workspaceFolders).toEqual([
      { uri: 'file:///Users/alice/code/rust-app', name: 'lingua' },
    ]);
  });
});

describe('RustAnalyzerLauncher crash recovery', () => {
  it.each([false, true])('contains recovery rejection when status delivery throws: %s', async (statusThrows) => {
    // The exit handler schedules one recovery attempt fire-and-forget. That
    // path resolves the binary and re-runs the initialize handshake, and
    // before the guard a rejection there surfaced as an unhandled rejection
    // in the main process — precisely when the server had already crashed.
    vi.useFakeTimers();
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      const { RustAnalyzerLauncher } = await import('../../../src/main/lsp/rustAnalyzerLauncher');
      const statuses: Array<{ kind: string; error?: string }> = [];
      const launcher = new RustAnalyzerLauncher({
        onStatus: (status) => {
          statuses.push(status);
          if (statusThrows) throw new Error('status observer destroyed');
        },
      }) as unknown as {
        status: () => { kind: string; error?: string };
        handleExit: (code: number | null, signal: NodeJS.Signals | null) => void;
        spawnAndInitializeRecovery: (exitDetail: string) => Promise<void>;
      };
      launcher.spawnAndInitializeRecovery = vi
        .fn()
        .mockRejectedValue(new Error('binary vanished mid-restart'));

      launcher.handleExit(1, null);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(rejections).toEqual([]);
      expect(launcher.status()).toEqual(statuses.at(-1));
      expect(statuses.at(-1)).toMatchObject({
        kind: 'degraded',
        error: expect.stringMatching(/rust-analyzer crashed \(code=1 signal=null\) and recovery failed: binary vanished mid-restart/u),
      });
    } finally {
      process.off('unhandledRejection', onRejection);
      vi.useRealTimers();
    }
  });
});
