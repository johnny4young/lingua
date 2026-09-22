#!/usr/bin/env node
// Real main/preload, esbuild and native execution with an isolated profile and sentinel files.
import { createRequire } from 'node:module';
import { _electron } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile, access, chmod } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const artifacts = path.join(root, 'output/playwright/node-preparation');
await mkdir(artifacts, { recursive: true });
const rendererUrl = 'http://127.0.0.1:5187';
const electronBinary = process.argv[2] ?? createRequire(import.meta.url)('electron');
const fixture = await mkdtemp(path.join(root, '.tmp-node-preparation-'));
const userData = await mkdtemp(path.join(artifacts, 'desktop-profile-'));
let server;
let app;
let page;
const errors = [];
const results = [];
try {
  server = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      '--config',
      'vite.renderer.config.mts',
      '--host',
      '127.0.0.1',
      '--port',
      '5187',
      '--strictPort',
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  server.stdout.on('data', data => process.stdout.write(data));
  server.stderr.on('data', data => process.stderr.write(data));
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Renderer server exited');
    try {
      if ((await fetch(rendererUrl)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(ready, 'Renderer server ready');
  app = await _electron.launch({
    executablePath: electronBinary,
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      LINGUA_SMOKE_USER_DATA_DIR: userData,
      LINGUA_RENDERER_URL: rendererUrl,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.locator('[data-testid="app-chrome"]').waitFor({ timeout: 60000 });
  const oldMarker = path.join(fixture, 'old-must-not-run');
  const currentPid = path.join(fixture, 'current.pid');
  await page.evaluate(
    async ({ oldMarker, currentPid }) => {
      const { NodeRunner } = await import('/src/renderer/runners/nodeRunner.ts');
      const { useSettingsStore } = await import('/src/renderer/stores/settingsStore.ts');
      useSettingsStore.setState({ nativeExecutionAcknowledged: true });
      const runner = new NodeRunner();
      const transpile = runner.transpileTs.bind(runner);
      let release;
      const held = new Promise(resolve => {
        release = resolve;
      });
      let prepared;
      const ready = new Promise(resolve => {
        prepared = resolve;
      });
      // Keep the real esbuild result, but control the preparation/Stop race.
      runner.transpileTs = async code => {
        const result = await transpile(code);
        prepared();
        await held;
        return result;
      };
      const old = runner.execute(
        `require('node:fs').writeFileSync(${JSON.stringify(oldMarker)}, 'UNEXPECTED');`,
        { language: 'typescript' }
      );
      await ready;
      runner.stop();
      const current = runner.execute(
        `require('node:fs').writeFileSync(${JSON.stringify(currentPid)}, String(process.pid)); setInterval(() => {}, 1000);`,
        { language: 'javascript' }
      );
      globalThis.__nodePreparationSmoke = {
        runner,
        old,
        current,
        release,
        currentRunId: runner.activeRunId,
      };
    },
    { oldMarker, currentPid }
  );
  let pid;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      pid = Number(await readFile(currentPid, 'utf8'));
      if (pid > 0) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert(pid > 0, 'The newer native child actually started');
  const result = await page.evaluate(async () => {
    const state = globalThis.__nodePreparationSmoke;
    state.release();
    const old = await state.old;
    state.runner.stop();
    const current = await state.current;
    return { old: old.kind, current: current.kind };
  });
  assert.deepEqual(result, { old: 'stopped', current: 'stopped' });
  await assert.rejects(access(oldMarker), error => error.code === 'ENOENT');
  let alive = true;
  for (let attempt = 0; attempt < 100 && alive; attempt++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') alive = false;
      else throw error;
    }
    if (alive) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert(!alive, 'Stop still owns the newer child after the old compiler settles');
  results.push({ ...result, oldSideEffectAbsent: true, currentChildGone: true });
  // A real executable pauses only its version probe. This holds main's detector
  // after IPC crossed, rather than mocking the runner or child-process API.
  // POSIX shebang fixture; platform-independent ownership is covered by unit CI.
  if (process.platform !== 'win32') {
    const bin = path.join(fixture, 'bin');
    const detecting = path.join(fixture, 'detecting');
    const releaseDetection = path.join(fixture, 'release-detection');
    const unexpected = path.join(fixture, 'unexpected-main-execution');
    await mkdir(bin);
    const executable = path.join(bin, 'node');
    await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
if (process.argv[2] !== '--version') {
  fs.writeFileSync(${JSON.stringify(unexpected)}, 'UNEXPECTED');
  process.exit(1);
}
fs.writeFileSync(${JSON.stringify(detecting)}, 'ready');
const timeout = setTimeout(() => process.exit(2), 4000);
const timer = setInterval(() => {
  if (!fs.existsSync(${JSON.stringify(releaseDetection)})) return;
  clearInterval(timer); clearTimeout(timeout);
  console.log(process.version);
}, 10);
`);
    await chmod(executable, 0o700);
    await page.evaluate(({ bin }) => {
      globalThis.__mainPreparationSmoke = window.lingua.node.run('console.log("must not execute")', {
        runId: 'main-preparing-smoke', userEnv: { PATH: bin },
      });
    }, { bin });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { await access(detecting); ready = true; break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert(ready, 'The real main-process detector is preparing the run');
    const stopped = await page.evaluate(() => window.lingua.node.stop('main-preparing-smoke'));
    await writeFile(releaseDetection, 'go');
    const cancelled = await page.evaluate(() => globalThis.__mainPreparationSmoke);
    assert.deepEqual(stopped, { stopped: true });
    assert.equal(cancelled.kind, 'stopped');
    await assert.rejects(access(unexpected), error => error.code === 'ENOENT');
    const recovery = await page.evaluate(() => window.lingua.node.run('console.log("recovered")', {
      runId: 'main-recovery-smoke',
    }));
    assert.equal(recovery.kind, 'success');
    assert.equal(recovery.stdout.trim(), 'recovered');
    results.push({ mainPreparation: 'stopped', oldSideEffectAbsent: true, recovery: 'success' });
  }
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(artifacts, 'result.json'),
    JSON.stringify(
      {
        results,
        errors,
        harness:
          'Playwright Electron, real main/preload, held real compiler continuation and real host detector fixture, isolated profile',
        packaged: false,
      },
      null,
      2
    )
  );
  console.log(
    'Node preparation smoke passed: real esbuild + native IPC, cancelled source never executes, Stop kills only the current child, zero console errors'
  );
} finally {
  // Even a negative-control failure must not orphan the newer real child.
  await page
    ?.evaluate(async () => {
      const state = globalThis.__nodePreparationSmoke;
      await window.lingua.node.stop('main-preparing-smoke');
      await window.lingua.node.stop('main-recovery-smoke');
      if (!state) return;
      state.release();
      if (state.currentRunId) await window.lingua.node.stop(state.currentRunId);
      delete globalThis.__nodePreparationSmoke;
    })
    .catch(() => {});
  await app?.close().catch(() => {});
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
  await rm(fixture, { recursive: true, force: true });
  await rm(userData, { recursive: true, force: true });
}
