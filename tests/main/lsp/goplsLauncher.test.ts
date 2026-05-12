/**
 * RL-026 Slice 4 — `GoplsLauncher` detection + init contract.
 *
 * Mirrors the rust-analyzer launcher tests. Most of the LSP framing
 * is covered by `lspProcess.test.ts`; here we pin the Go-specific
 * pieces:
 *   - `resolveGoplsBinary` precedence — PATH first, then
 *     `$GOPATH/bin/gopls`, then `~/go/bin/gopls`.
 *   - `buildInitializeParams` returns `null` for `rootUri` /
 *     `workspaceFolders` when no workspaceRoot is supplied (so gopls
 *     does not anchor itself to the user home), and a file URI plus
 *     a workspaceFolders entry when one IS supplied.
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
  // Detection looks at process.env.GOPATH; reset between cases so a
  // stray runner env does not bleed into the precedence test.
  delete process.env.GOPATH;
});

describe('resolveGoplsBinary', () => {
  it('returns command "gopls" when PATH lookup succeeds', async () => {
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: readonly string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string) => void
      ) => {
        cb(null, 'golang.org/x/tools/gopls v0.16.2\n');
      }
    );
    accessMock.mockRejectedValue(new Error('should not be called'));

    const { resolveGoplsBinary } = await import(
      '../../../src/main/lsp/goplsLauncher'
    );
    const result = await resolveGoplsBinary();
    expect(result?.source).toBe('path');
    expect(result?.command).toMatch(/gopls/);
  });

  it('falls back to $GOPATH/bin/gopls when PATH lookup fails', async () => {
    process.env.GOPATH = '/Users/alice/dev/go';
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
    accessMock.mockResolvedValue(undefined);

    const { resolveGoplsBinary } = await import(
      '../../../src/main/lsp/goplsLauncher'
    );
    const result = await resolveGoplsBinary();
    expect(result?.source).toBe('gopath-bin');
    expect(result?.command).toMatch(/Users[\\/]alice[\\/]dev[\\/]go[\\/]bin[\\/]gopls/);
  });

  it('falls back to ~/go/bin/gopls when neither PATH nor $GOPATH exist', async () => {
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
    accessMock.mockResolvedValue(undefined);

    const { resolveGoplsBinary } = await import(
      '../../../src/main/lsp/goplsLauncher'
    );
    const result = await resolveGoplsBinary();
    expect(result?.source).toBe('home-go-bin');
    expect(result?.command).toMatch(/go[\\/]bin[\\/]gopls/);
  });

  it('returns null when neither PATH nor the fallback paths contain the binary', async () => {
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

    const { resolveGoplsBinary } = await import(
      '../../../src/main/lsp/goplsLauncher'
    );
    const result = await resolveGoplsBinary();
    expect(result).toBeNull();
  });
});

describe('detectGoplsVersion', () => {
  it('keeps just the first line of multi-line gopls output', async () => {
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: readonly string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string) => void
      ) => {
        cb(null, 'golang.org/x/tools/gopls v0.16.2\nbuild abc1234\n');
      }
    );

    const { detectGoplsVersion } = await import(
      '../../../src/main/lsp/goplsLauncher'
    );
    const version = await detectGoplsVersion('/usr/local/bin/gopls');
    expect(version).toBe('golang.org/x/tools/gopls v0.16.2');
  });
});

describe('GoplsLauncher initialize params', () => {
  it('does not default the workspace root to the user home directory', async () => {
    const { GoplsLauncher } = await import('../../../src/main/lsp/goplsLauncher');
    const launcher = new GoplsLauncher() as unknown as {
      buildInitializeParams: () => Record<string, unknown>;
    };

    const params = launcher.buildInitializeParams();

    expect(params.rootUri).toBeNull();
    expect(params.workspaceFolders).toBeNull();
  });

  it('uses an explicit workspace root when one is supplied', async () => {
    const { GoplsLauncher } = await import('../../../src/main/lsp/goplsLauncher');
    const launcher = new GoplsLauncher({
      workspaceRoot: '/Users/alice/code/go-app',
    }) as unknown as {
      buildInitializeParams: () => Record<string, unknown>;
    };

    const params = launcher.buildInitializeParams();

    expect(params.rootUri).toBe('file:///Users/alice/code/go-app');
    expect(params.workspaceFolders).toEqual([
      { uri: 'file:///Users/alice/code/go-app', name: 'lingua' },
    ]);
  });
});
