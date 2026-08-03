import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  resolveLldbDapBinary,
  resolveRustCompiler,
  RustDebugSession,
} from '../../src/main/rustDebugger';

const lldbFixturePath = path.join(process.cwd(), 'tests', '__fixtures__', 'fake-lldb-dap.mjs');
const rustcFixturePath = path.join(process.cwd(), 'tests', '__fixtures__', 'fake-rustc.mjs');

describe('RustDebugSession (DAP fixture)', () => {
  let dir: string;
  let scriptPath: string;
  let binaryPath: string;

  beforeAll(() => {
    chmodSync(lldbFixturePath, 0o755);
    chmodSync(rustcFixturePath, 0o755);
    dir = mkdtempSync(path.join(tmpdir(), 'lingua-rust-debug-test-'));
    scriptPath = path.join(dir, 'main.rs');
    binaryPath = path.join(dir, 'main');
    writeFileSync(
      scriptPath,
      'fn main() {\n    let value = 2;\n    println!("result {value}");\n}\n',
      'utf8'
    );
    writeFileSync(binaryPath, 'fixture', 'utf8');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('resolves explicit compiler and LLDB DAP executables', async () => {
    await expect(
      resolveRustCompiler({ ...process.env, RUSTC: rustcFixturePath })
    ).resolves.toMatchObject({ command: rustcFixturePath, version: expect.stringContaining('rustc') });
    await expect(
      resolveLldbDapBinary({ ...process.env, LLDB_DAP: lldbFixturePath }, 'linux')
    ).resolves.toMatchObject({ command: lldbFixturePath, version: expect.stringContaining('lldb-dap') });
  });

  it('starts, inspects locals and watches, steps, and finishes through stdio DAP', async () => {
    const session = new RustDebugSession({
      lldbDapPath: lldbFixturePath,
      scriptPath,
      binaryPath,
      cwd: dir,
      env: process.env,
    });
    try {
      await expect(session.start([3])).resolves.toMatchObject({
        kind: 'stopped',
        reason: 'breakpoint',
      });
      await expect(session.inspect('rust-tab', ['value * 2'], 'user-breakpoint')).resolves.toEqual({
        tabId: 'rust-tab',
        line: 3,
        reason: 'user-breakpoint',
        locals: { value: '2' },
        callStack: [{ functionName: 'main::main', line: 3 }],
        watchResults: { 'value * 2': { value: '4' } },
      });
      await expect(session.command('step-over')).resolves.toMatchObject({ kind: 'stopped' });
      await expect(session.inspect('rust-tab', [], 'step')).resolves.toMatchObject({ line: 4 });
      await expect(session.command('continue')).resolves.toEqual({ kind: 'finished' });
      expect(session.drainOutput().output).toContain('result 2');
    } finally {
      session.terminate();
    }
  });
});
