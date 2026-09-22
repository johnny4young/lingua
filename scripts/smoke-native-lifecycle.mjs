#!/usr/bin/env node
// Real Electron IPC and installed runtimes; only the child-spawn observer is instrumented.
import { createRequire } from 'node:module';
import { _electron } from 'playwright';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

assert.notEqual(process.platform, 'win32', 'POSIX live smoke; Windows tree termination is covered in CI');
const root = process.cwd();
const artifacts = path.join(root, 'output/playwright/native-lifecycle');
await mkdir(artifacts, { recursive: true });
const fixture = await mkdtemp(path.join(artifacts, 'fixture-'));
const rendererUrl = 'http://127.0.0.1:5187';
const electronBinary = process.argv[2] ?? createRequire(import.meta.url)('electron');
const runtimes = ['node', 'ruby', 'deno', 'bun'];
const errors = [];
const results = [];
const ownedPids = new Set();
const debuggerPidFiles = [];
let server;
let app;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, attempts = 200) {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(message);
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}
async function watchPage(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.locator('[data-testid="app-chrome"]').waitFor({ timeout: 60000 });
}
try {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.renderer.config.mts', '--host', '127.0.0.1', '--port', '5187', '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', data => process.stdout.write(data));
  server.stderr.on('data', data => process.stderr.write(data));
  await until(async () => {
    assert.equal(server.exitCode, null, 'Renderer server remains alive');
    try { return (await fetch(rendererUrl)).ok; } catch { return false; }
  }, 'Renderer server did not become ready');
  for (const phase of ['debugger-cleanup', 'early-parent-close', 'window-close', 'app-quit']) {
    const profile = path.join(fixture, phase);
    app = await _electron.launch({ executablePath: electronBinary, args: [root], cwd: root, env: {
      ...process.env, LINGUA_SMOKE_USER_DATA_DIR: profile, LINGUA_RENDERER_URL: rendererUrl,
      ELECTRON_RUN_AS_NODE: undefined,
    }, timeout: 30000 });
    let page = await app.firstWindow();
    await watchPage(page);
    await app.evaluate(() => {
      const cp = process.getBuiltinModule('child_process');
      const path = process.getBuiltinModule('path');
      const { syncBuiltinESMExports } = process.getBuiltinModule('module');
      const realSpawn = cp.spawn;
      globalThis.__nativeLifecycleChildren = [];
      cp.spawn = (...args) => {
        const child = realSpawn(...args);
        const runtime = path.basename(String(args[0]));
        if (['node', 'ruby', 'deno', 'bun'].includes(runtime) && child.pid) {
          const record = { pid: child.pid, runtime, ready: false };
          globalThis.__nativeLifecycleChildren.push(record);
          let output = '';
          child.stdout?.on('data', data => {
            output += data.toString();
            record.ready = output.includes('LIFECYCLE_READY');
          });
        }
        return child;
      };
      syncBuiltinESMExports();
    });
    if (phase === 'debugger-cleanup') {
      for (const [runtime, mode] of [['python', 'stop'], ['go', 'stop'], ['go', 'timeout'], ['go', 'exit'], ['go', 'connection'], ['go', 'owner-during-start']]) {
        const name = `${runtime}-${mode}`;
        const directory = path.join(fixture, name);
        await mkdir(directory);
        const parentFile = path.join(directory, 'parent.pid');
        const childFile = path.join(directory, 'child.pid');
        debuggerPidFiles.push(parentFile, childFile);
        const childCode = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(childFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
        let source;
        let userEnv;
        let executable;
        let healthyAdapter;
        if (runtime === 'python') {
          source = [
            'import os, subprocess, time',
            `open(${JSON.stringify(parentFile)}, 'w').write(str(os.getpid()))`,
            `subprocess.Popen([${JSON.stringify(process.execPath)}, '-e', ${JSON.stringify(childCode)}], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)`,
            `while not os.path.exists(${JSON.stringify(childFile)}): time.sleep(0.01)`,
            'marker = 1',
            'while True: time.sleep(0.1)',
          ].join('\n');
        } else {
          // Controlled real adapter process, not a claim about installed Delve.
          // Real IPC still performs detection, staging and the DAP handshake.
          source = 'package main\nfunc main() {\nprintln(1)\n}';
          executable = path.join(directory, 'dlv');
          const protocol = pathToFileURL(path.join(root, 'tests/__fixtures__/fake-dlv.mjs')).href;
          const version = `if (process.argv[2] === 'version') { console.log('Delve Debugger fixture'); process.exit(0); }`;
          healthyAdapter = `#!/usr/bin/env node\n${version}\nawait import(${JSON.stringify(protocol)});\n`;
          const action = mode === 'stop' ? `await import(${JSON.stringify(protocol)});` : mode === 'exit' ? 'process.exit(2);' : mode === 'connection' ? `
            const net = await import('node:net');
            const server = net.createServer();
            server.listen(0, '127.0.0.1', () => {
              const port = server.address().port;
              server.close(() => console.log('DAP server listening at: 127.0.0.1:' + port));
            });
            setInterval(() => {}, 1000);` : 'setInterval(() => {}, 1000);';
          await writeFile(executable, `#!/usr/bin/env node
${version}
const { spawn } = await import('node:child_process');
const { existsSync, writeFileSync } = await import('node:fs');
writeFileSync(${JSON.stringify(parentFile)}, String(process.pid));
spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(childCode)}], { stdio: 'ignore' });
while (!existsSync(${JSON.stringify(childFile)})) await new Promise(resolve => setTimeout(resolve, 10));
${mode === 'stop' ? '' : "process.on('SIGTERM', () => {});"}
${action}
`);
          await chmod(executable, 0o755);
          userEnv = { PATH: `${directory}${path.delimiter}${process.env.PATH}` };
        }
        const request = { tabId: name, source, fileName: runtime === 'python' ? 'main.py' : 'main.go', breakpoints: [runtime === 'python' ? 5 : 3], watches: [], userEnv };
        let result;
        if (mode === 'owner-during-start') {
          await page.evaluate(({ runtime, request }) => {
            globalThis.__pendingDebuggerStart = window.lingua[`${runtime}Debugger`].start(request);
          }, { runtime, request });
          await until(async () => {
            try { return Number(await readFile(childFile, 'utf8')) > 0; }
            catch (error) { if (error.code === 'ENOENT') return false; throw error; }
          }, 'Delve startup fixture did not create its resistant descendant');
        } else {
          result = await page.evaluate(({ runtime, request }) => window.lingua[`${runtime}Debugger`].start(request), { runtime, request });
        }
        const pids = [Number(await readFile(parentFile, 'utf8')), Number(await readFile(childFile, 'utf8'))];
        for (const pid of pids) { assert(pid > 0); ownedPids.add(pid); }
        if (mode === 'owner-during-start') {
          assert(pids.every(alive));
          await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].destroy());
          // Must precede the old five-second adapter startup timeout.
          await until(() => pids.every(pid => !alive(pid)), 'Owner loss did not cancel pending adapter startup', 30);
          const nextWindow = app.waitForEvent('window');
          await app.evaluate(({ app }) => app.emit('activate'));
          page = await nextWindow;
          await watchPage(page);
        } else if (mode === 'stop') {
          assert.equal(result.kind, 'paused', JSON.stringify(result));
          assert(pids.every(alive));
          const stopped = await page.evaluate(({ runtime, id }) => window.lingua[`${runtime}Debugger`].stop(id), { runtime, id: result.sessionId });
          assert.equal(stopped.kind, 'stopped');
        } else {
          assert.equal(result.kind, 'error');
          assert.match(result.message ?? '', mode === 'timeout' ? /startup timed out/i : mode === 'exit' ? /exited before startup/i : /ECONNREFUSED/);
        }
        await until(() => pids.every(pid => !alive(pid)), `${name} debugger left an adapter/debuggee alive`);
        if (executable) await writeFile(executable, healthyAdapter);
        const recoveryRequest = { ...request, tabId: `${name}-recovery`, source: runtime === 'python' ? 'value = 1\nvalue += 1\nprint(value)' : source, breakpoints: [runtime === 'python' ? 2 : 3] };
        const recovered = await page.evaluate(({ runtime, request }) => window.lingua[`${runtime}Debugger`].start(request), { runtime, request: recoveryRequest });
        assert.equal(recovered.kind, 'paused', JSON.stringify(recovered));
        const stopped = await page.evaluate(({ runtime, id }) => window.lingua[`${runtime}Debugger`].stop(id), { runtime, id: recovered.sessionId });
        assert.equal(stopped.kind, 'stopped');
        results.push({ phase, runtime, mode, parentGone: true, descendantGone: true, recovery: true, adapterFixture: runtime === 'go' });
      }
      // Reproduce the detection-to-spawn race through IPC, using a disposable
      // adapter that removes only itself after its successful version probe.
      const missingAdapter = path.join(fixture, 'vanishing-lldb.mjs');
      const rustcFixture = path.join(root, 'tests/__fixtures__/fake-rustc.mjs');
      const lldbFixture = pathToFileURL(path.join(root, 'tests/__fixtures__/fake-lldb-dap.mjs')).href;
      await chmod(rustcFixture, 0o755);
      await writeFile(missingAdapter, `#!/usr/bin/env node
import { unlinkSync } from 'node:fs';
unlinkSync(process.argv[1]);
console.log('lldb-dap fixture');
`);
      await chmod(missingAdapter, 0o755);
      const rustRequest = { tabId: 'missing-adapter', source: 'fn main() {\nlet value = 1;\nprintln!("{}", value);\n}', fileName: 'main.rs', breakpoints: [3], watches: [], userEnv: { RUSTC: rustcFixture, LLDB_DAP: missingAdapter } };
      const missing = await page.evaluate(request => window.lingua.rustDebugger.start(request), rustRequest);
      assert.equal(missing.kind, 'error');
      assert.match(missing.message ?? '', /ENOENT/);
      await page.locator('[data-testid="app-chrome"]').waitFor();
      await writeFile(missingAdapter, `#!/usr/bin/env node\nawait import(${JSON.stringify(lldbFixture)});\n`);
      await chmod(missingAdapter, 0o755);
      const recoveredRust = await page.evaluate(request => window.lingua.rustDebugger.start(request), { ...rustRequest, tabId: 'adapter-recovery' });
      assert.equal(recoveredRust.kind, 'paused', JSON.stringify(recoveredRust));
      const stoppedRust = await page.evaluate(id => window.lingua.rustDebugger.stop(id), recoveredRust.sessionId);
      assert.equal(stoppedRust.kind, 'stopped');
      results.push({ phase, runtime: 'rust', mode: 'missing-adapter-after-detection', adapterFixture: true, compilerFixture: true, recovered: true });
      await app.close();
      app = undefined;
      continue;
    }
    if (phase === 'early-parent-close') {
      // Node exercises the shared supervisor; installed Bun exercises the Alt
      // supervisor. Deno's read-only sandbox is deliberately not widened.
      for (const runtime of ['node', 'bun']) {
        for (const mode of ['stop', 'timeout']) {
          const runId = `${runtime}-${mode}-early-parent`;
          const pidFile = path.join(fixture, `${runId}.pid`);
          const childCode = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
          const source = `require('node:child_process').spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(childCode)}], { stdio: 'ignore' }); console.log('LIFECYCLE_READY'); setInterval(() => {}, 1000);`;
          const before = await app.evaluate(() => globalThis.__nativeLifecycleChildren.length);
          await page.evaluate(({ runtime, source, runId, mode }) => {
            globalThis.__earlyParentRun = window.lingua[runtime].run(source, {
              runId, timeoutMs: mode === 'timeout' ? 3000 : 60000,
            });
          }, { runtime, source, runId, mode });
          let parent;
          let descendant;
          await until(async () => {
            const records = await app.evaluate((_electron, before) => globalThis.__nativeLifecycleChildren.slice(before), before);
            for (const record of records) ownedPids.add(record.pid);
            parent = records.find(record => record.runtime === runtime && record.ready);
            try { descendant = Number(await readFile(pidFile, 'utf8')); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
            if (descendant > 0) ownedPids.add(descendant);
            return parent && descendant > 0;
          }, `${runId} did not start a real parent and resistant descendant`);
          assert(alive(parent.pid) && alive(descendant), `${runId}: parent ${parent.pid} and descendant ${descendant} must both be alive before cancellation`);
          if (mode === 'stop') {
            const stopped = await page.evaluate(({ runtime, runId }) => window.lingua[runtime].stop(runId), { runtime, runId });
            assert.equal(stopped.stopped, true);
          }
          const result = await page.evaluate(() => globalThis.__earlyParentRun);
          assert.equal(result.kind, mode === 'stop' ? 'stopped' : 'timeout');
          await until(() => !alive(parent.pid) && !alive(descendant), `${runId} leaked a descendant after parent close`);
          const recovered = await page.evaluate(({ runtime, runId }) => window.lingua[runtime].run(
            "console.log('recovered')", { runId: `${runId}-recovery` }
          ), { runtime, runId });
          assert.equal(recovered.kind, 'success');
          assert.equal(recovered.stdout.trim(), 'recovered');
          results.push({ phase, runtime, mode, parentGone: true, descendantGone: true, recovery: true });
        }
      }
      await app.close();
      app = undefined;
      continue;
    }
    const grandchildFile = path.join(fixture, `${phase}-grandchild.pid`);
    const grandchildCode = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(grandchildFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const sources = {
      node: `process.on('SIGTERM', () => {}); require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchildCode)}], { stdio: 'ignore' }); console.log('LIFECYCLE_READY'); setInterval(() => {}, 1000);`,
      ruby: "$stdout.sync = true; trap('TERM') {}; puts 'LIFECYCLE_READY'; loop { sleep 1 }",
      deno: "Deno.addSignalListener('SIGTERM', () => {}); console.log('LIFECYCLE_READY'); setInterval(() => {}, 1000);",
      bun: "process.on('SIGTERM', () => {}); console.log('LIFECYCLE_READY'); setInterval(() => {}, 1000);",
    };
    await page.evaluate(sources => {
      globalThis.__nativeLifecycleRuns = Object.entries(sources).map(([runtime, source]) =>
        window.lingua[runtime].run(source, { runId: `lifecycle-${runtime}`, timeoutMs: 60000 })
      );
    }, sources);
    let records;
    await until(async () => {
      records = await app.evaluate(() => globalThis.__nativeLifecycleChildren);
      for (const record of records) ownedPids.add(record.pid);
      return records.length === 4 && records.every(record => record.ready);
    }, 'All four installed runtimes must start and install their TERM handlers');
    let grandchild;
    await until(async () => {
      try { grandchild = Number(await readFile(grandchildFile, 'utf8')); return grandchild > 0; }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    }, 'Node grandchild did not become ready');
    ownedPids.add(grandchild);
    const pids = [...records.map(record => record.pid), grandchild];
    assert(pids.every(alive), 'Real children and grandchild are running');
    if (phase === 'window-close') {
      // AbortSignal is already aborted when the owner subsequently disappears.
      const stops = await page.evaluate(async runtimes => Promise.all(runtimes.map(runtime =>
        window.lingua[runtime].stop(`lifecycle-${runtime}`)
      )), runtimes);
      assert(stops.every(result => result.stopped), 'All graceful Stop requests found their owner');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].destroy());
    } else {
      const exited = new Promise(resolve => app.process().once('exit', resolve));
      await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); });
      await Promise.race([exited, delay(10000).then(() => { throw new Error('App did not exit'); })]);
    }
    await until(() => pids.every(pid => !alive(pid)), `${phase} left a native process alive`);
    if (phase === 'window-close' && process.platform === 'darwin') {
      const newWindow = app.waitForEvent('window');
      await app.evaluate(({ app }) => app.emit('activate'));
      const recovered = await newWindow;
      await watchPage(recovered);
      for (const runtime of runtimes) {
        const result = await recovered.evaluate(async runtime => window.lingua[runtime].run(
          runtime === 'ruby' ? "puts 'recovered'" : "console.log('recovered')", { runId: `recovered-${runtime}` }
        ), runtime);
        assert.equal(result.kind, 'success');
        assert.equal(result.stdout.trim(), 'recovered');
      }
    }
    results.push({ phase, runtimes, childrenGone: 4, grandchildGone: true, sameAppRecovery: phase === 'window-close' && process.platform === 'darwin' });
    await app.close().catch(() => {});
    app = undefined;
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ results, errors, packaged: false, harness: 'Real Electron/main/preload, installed runtimes and controlled DAP adapter fixtures, observed actual child PIDs' }, null, 2));
  console.log('Native lifecycle passed: early parent close after Stop/timeout, window close, app quit, real runtimes, descendants, recovery, zero errors');
} finally {
  for (const file of debuggerPidFiles) {
    try { const pid = Number(await readFile(file, 'utf8')); if (pid > 0) ownedPids.add(pid); } catch {}
  }
  await app?.close().catch(() => {});
  // Only exact PIDs observed from this isolated app/fixture; never broad pkill.
  for (const pid of ownedPids) {
    if (!alive(pid)) continue;
    try { process.kill(-pid, 'SIGKILL'); } catch {}
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
  await rm(fixture, { recursive: true, force: true });
}
