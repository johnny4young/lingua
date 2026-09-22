#!/usr/bin/env node
// Real Electron IPC and installed runtimes; only the child-spawn observer is instrumented.
import { createRequire } from 'node:module';
import { _electron } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
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
let server;
let app;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  for (let i = 0; i < 200; i++) {
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
  for (const phase of ['early-parent-close', 'window-close', 'app-quit']) {
    const profile = path.join(fixture, phase);
    app = await _electron.launch({ executablePath: electronBinary, args: [root], cwd: root, env: {
      ...process.env, LINGUA_SMOKE_USER_DATA_DIR: profile, LINGUA_RENDERER_URL: rendererUrl,
      ELECTRON_RUN_AS_NODE: undefined,
    }, timeout: 30000 });
    const page = await app.firstWindow();
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
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ results, errors, packaged: false, harness: 'Real Electron/main/preload, installed runtimes ignoring TERM, observed actual child PIDs' }, null, 2));
  console.log('Native lifecycle passed: early parent close after Stop/timeout, window close, app quit, real runtimes, descendants, recovery, zero errors');
} finally {
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
