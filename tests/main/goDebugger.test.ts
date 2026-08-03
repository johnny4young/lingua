import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GoDebugSession, resolveDelveBinary } from '../../src/main/goDebugger';

const fixturePath = path.join(process.cwd(), 'tests', '__fixtures__', 'fake-dlv.mjs');

describe('GoDebugSession (DAP fixture)', () => {
  let dir: string;
  let scriptPath: string;

  beforeAll(() => {
    chmodSync(fixturePath, 0o755);
    dir = mkdtempSync(path.join(tmpdir(), 'lingua-go-debug-test-'));
    scriptPath = path.join(dir, 'main.go');
    writeFileSync(
      scriptPath,
      'package main\nfunc main() {\n\tvalue := 2\n\tprintln(value)\n}\n',
      'utf8'
    );
    writeFileSync(path.join(dir, 'go.mod'), 'module lingua_debug\n\ngo 1.21\n', 'utf8');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('resolves and probes an explicit Delve-compatible executable', async () => {
    const binDir = mkdtempSync(path.join(tmpdir(), 'lingua-dlv-path-'));
    const linkedPath = path.join(binDir, process.platform === 'win32' ? 'dlv.exe' : 'dlv');
    try {
      writeFileSync(linkedPath, `#!/bin/sh\nexec "${process.execPath}" "${fixturePath}" "$@"\n`);
      chmodSync(linkedPath, 0o755);
      const resolved = await resolveDelveBinary({ ...process.env, PATH: binDir });
      expect(resolved?.command).toBe(process.platform === 'win32' ? 'dlv.exe' : 'dlv');
      expect(resolved?.version).toContain('Delve Debugger');
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it('starts, inspects locals and watches, steps, and finishes through DAP', async () => {
    const session = new GoDebugSession({
      dlvPath: fixturePath,
      scriptPath,
      programDir: dir,
      cwd: dir,
      env: process.env,
    });
    try {
      await expect(session.start([4])).resolves.toMatchObject({
        kind: 'stopped',
        reason: 'breakpoint',
      });
      await expect(session.inspect('go-tab', ['value * 2'], 'user-breakpoint')).resolves.toEqual({
        tabId: 'go-tab',
        line: 4,
        reason: 'user-breakpoint',
        locals: { value: '2' },
        callStack: [{ functionName: 'main.main', line: 4 }],
        watchResults: { 'value * 2': { value: '4' } },
      });
      const stepped = session.command('step-over');
      await expect(session.command('step-into')).rejects.toThrow(/not paused/i);
      await expect(stepped).resolves.toMatchObject({ kind: 'stopped' });
      await expect(session.inspect('go-tab', [], 'step')).resolves.toMatchObject({ line: 5 });
      await expect(session.command('continue')).resolves.toEqual({ kind: 'finished' });
      expect(session.drainOutput().output).toContain('result 2');
    } finally {
      session.terminate();
    }
  });
});
