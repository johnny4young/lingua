import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PythonDebugSession } from '../../src/main/pythonDebugger';
import { RustDebugSession } from '../../src/main/rustDebugger';
import { GoDebugSession } from '../../src/main/goDebugger';

const python = ['python3', 'python'].find(binary => spawnSync(binary, ['--version']).status === 0);
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'lingua-debug-descendant-'));
  const parentFile = path.join(directory, 'parent.pid');
  const childFile = path.join(directory, 'child.pid');
  const pid = async (file: string) => Number(await readFile(file, 'utf8'));
  const childCode = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(childFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  const prefix = `#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(parentFile)}, String(process.pid));
spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(childCode)}], { stdio: 'ignore' });
while (!existsSync(${JSON.stringify(childFile)})) await new Promise(resolve => setTimeout(resolve, 10));
`;
  return {
    directory, parentFile, childFile, prefix,
    async identities() {
      await expect.poll(async () => {
        try { return (await pid(childFile)) > 0; } catch { return false; }
      }, { timeout: 5000 }).toBe(true);
      return { parent: await pid(parentFile), child: await pid(childFile) };
    },
    async cleanup() {
      for (const [file, group] of [[parentFile, true], [childFile, false]] as const) {
        let identity: number;
        try { identity = await pid(file); } catch { continue; }
        if (!(identity > 0)) continue;
        try { process.kill(group ? -identity : identity, 'SIGKILL'); } catch { /* Already gone. */ }
        await expect.poll(() => alive(identity), { timeout: 2000 }).toBe(false);
      }
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe.runIf(process.platform !== 'win32')('debugger descendant lifecycle with real processes', () => {
  it.runIf(!!python)('Python Stop reaps an independent-pipe descendant after pdb exits', async () => {
    const f = await fixture();
    const scriptPath = path.join(f.directory, 'main.py');
    const source = [
      'import os, subprocess, time',
      `open(${JSON.stringify(f.parentFile)}, 'w').write(str(os.getpid()))`,
      `subprocess.Popen([${JSON.stringify(process.execPath)}, '-e', ${JSON.stringify(`process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(f.childFile)}, String(process.pid)); setInterval(() => {}, 1000);`)}], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)`,
      `while not os.path.exists(${JSON.stringify(f.childFile)}): time.sleep(0.01)`,
      'marker = 1',
      'while True: time.sleep(0.1)',
    ].join('\n');
    await writeFile(scriptPath, source);
    const session = new PythonDebugSession({ scriptPath, pythonPath: python! });
    try {
      await session.start();
      await session.setBreakpoint(5);
      expect((await session.continue()).location?.line).toBe(5);
      const ids = await f.identities();
      expect(alive(ids.parent) && alive(ids.child)).toBe(true);
      session.terminate();
      await expect.poll(() => alive(ids.parent), { timeout: 2000 }).toBe(false);
      await expect.poll(() => alive(ids.child), { timeout: 2000 }).toBe(false);
    } finally { session.terminate(); await f.cleanup(); }
  }, 15000);

  it('DAP Stop reaps an independent-pipe descendant after the adapter exits', async () => {
    const f = await fixture();
    const executable = path.join(f.directory, 'adapter.mjs');
    const protocolFixture = pathToFileURL(path.join(process.cwd(), 'tests/__fixtures__/fake-lldb-dap.mjs')).href;
    await writeFile(executable, `${f.prefix}\nawait import(${JSON.stringify(protocolFixture)});\n`);
    await chmod(executable, 0o755);
    const session = new RustDebugSession({
      lldbDapPath: executable, scriptPath: path.join(f.directory, 'main.rs'),
      binaryPath: path.join(f.directory, 'main'), cwd: f.directory, env: process.env,
    });
    try {
      await expect(session.start([3])).resolves.toMatchObject({ kind: 'stopped' });
      const ids = await f.identities();
      expect(alive(ids.parent) && alive(ids.child)).toBe(true);
      session.terminate();
      await expect.poll(() => alive(ids.parent), { timeout: 2000 }).toBe(false);
      await expect.poll(() => alive(ids.child), { timeout: 2000 }).toBe(false);
    } finally { session.terminate(); await f.cleanup(); }
  }, 15000);

  it('Stop cancels Delve before its startup address arrives', async () => {
    const f = await fixture();
    const executable = path.join(f.directory, 'delayed-dlv.mjs');
    await writeFile(executable, `${f.prefix}\nprocess.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n`);
    await chmod(executable, 0o755);
    const session = new GoDebugSession({ dlvPath: executable, scriptPath: path.join(f.directory, 'main.go'), programDir: f.directory, cwd: f.directory, env: process.env });
    const outcome = session.start([3]).catch(error => error);
    try {
      const ids = await f.identities();
      session.terminate();
      await expect.poll(() => alive(ids.parent), { timeout: 1000 }).toBe(false);
      await expect.poll(() => alive(ids.child), { timeout: 1000 }).toBe(false);
      expect((await outcome).message).toMatch(/stopped/i);
    } finally { session.terminate(); await f.cleanup(); await outcome; }
  }, 15000);

  it.each(['timeout', 'exit', 'connection'] as const)('Delve startup %s leaves no adapter tree', async mode => {
    const f = await fixture();
    const executable = path.join(f.directory, 'dlv.mjs');
    const action = mode === 'exit' ? 'process.exit(2);' : mode === 'connection' ? `
import net from 'node:net';
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  server.close(() => console.log('DAP server listening at: 127.0.0.1:' + port));
});
setInterval(() => {}, 1000);` : 'setInterval(() => {}, 1000);';
    await writeFile(executable, `${f.prefix}\nprocess.on('SIGTERM', () => {});\n${action}\n`);
    await chmod(executable, 0o755);
    const session = new GoDebugSession({ dlvPath: executable, scriptPath: path.join(f.directory, 'main.go'), programDir: f.directory, cwd: f.directory, env: process.env });
    try {
      await expect(session.start([3])).rejects.toThrow(mode === 'timeout' ? /startup timed out/i : mode === 'exit' ? /exited before startup/i : /ECONNREFUSED/);
      const ids = await f.identities();
      await expect.poll(() => alive(ids.parent), { timeout: 2000 }).toBe(false);
      await expect.poll(() => alive(ids.child), { timeout: 2000 }).toBe(false);
    } finally { session.terminate(); await f.cleanup(); }
  }, 15000);
});
