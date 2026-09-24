#!/usr/bin/env node
// Exercise malformed filesystem payloads through a real Electron main/preload seam.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron } from 'playwright';

const root = process.cwd();
const url = 'http://127.0.0.1:5187';
const electronBinary = process.argv[2] ?? createRequire(import.meta.url)('electron');
// Project capabilities intentionally reject OS temp and private .codex paths.
// An isolated worktree under .codex can point this at a safe project parent.
const fixtureParent = process.env.LINGUA_SMOKE_FIXTURE_DIR ?? root;
const fixture = await mkdtemp(path.join(fixtureParent, '.tmp-lingua-fs-ipc-'));
const profile = await mkdtemp(path.join(os.tmpdir(), 'lingua-fs-ipc-profile-'));
let server;
let app;
const errors = [];

try {
  server = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', '--config', 'vite.renderer.config.mts',
    '--host', '127.0.0.1', '--port', '5187', '--strictPort',
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', chunk => process.stdout.write(chunk));
  server.stderr.on('data', chunk => process.stderr.write(chunk));
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error('Renderer server exited');
    try {
      if ((await fetch(url)).ok) { ready = true; break; }
    } catch { /* The server is not listening yet. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(ready, 'Renderer server ready');

  app = await _electron.launch({
    executablePath: electronBinary,
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      LINGUA_SMOKE_USER_DATA_DIR: profile,
      LINGUA_RENDERER_URL: url,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30_000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.locator('[data-testid="app-chrome"]').waitFor({ timeout: 60_000 });
  await app.evaluate(({ dialog }, selectedPath) => {
    globalThis.__fsSmokeDialogs = { open: 0, save: 0, message: 0 };
    dialog.showOpenDialog = async () => {
      globalThis.__fsSmokeDialogs.open += 1;
      return { canceled: false, filePaths: [selectedPath] };
    };
    dialog.showSaveDialog = async () => {
      globalThis.__fsSmokeDialogs.save += 1;
      return { canceled: true, filePath: undefined };
    };
    dialog.showMessageBox = async () => {
      globalThis.__fsSmokeDialogs.message += 1;
      return { response: 1, checkboxChecked: false };
    };
  }, fixture);

  const rootId = await page.evaluate(async () => {
    const selected = await window.lingua.fs.selectDirectory();
    if (selected.canceled) throw new Error('Fixture picker canceled');
    return selected.rootId;
  });
  assert.equal(typeof rootId, 'string');
  await writeFile(path.join(fixture, 'keep.txt'), 'unchanged');

  const results = await page.evaluate(async rootId => {
    const fs = window.lingua.fs;
    async function invalid(label, operation) {
      try {
        await operation();
        throw new Error(`${label} unexpectedly succeeded`);
      } catch (error) {
        const message = String(error);
        if (message.includes('never-log-this')) {
          throw new Error('Rejected payload leaked into IPC error', { cause: error });
        }
        if (!message.includes('ERR_INVALID_IPC_ARGUMENTS') &&
            !message.includes('Invalid IPC arguments')) throw error;
        return label;
      }
    }
    const rejected = [];
    rejected.push(await invalid('write object', () => fs.write(rootId, 'object.txt', { secret: 'never-log-this' })));
    rejected.push(await invalid('delete string boolean', () => fs.delete(rootId, 'keep.txt', 'directory')));
    rejected.push(await invalid('bundle array options', () => fs.exportBundle(rootId, ['invalid'])));
    rejected.push(await invalid('bundle Map options', () => fs.exportBundle(rootId, new Map())));
    rejected.push(await invalid('search null query', () => fs.searchInFiles(rootId, '', null)));
    rejected.push(await invalid('search Date options', () => fs.searchInFiles(rootId, '', 'keep', new Date())));

    const changed = [];
    const unsubscribe = fs.onChanged(event => changed.push(event));
    const watchId = await fs.watchStart(rootId, '');
    if (typeof watchId !== 'string') throw new Error('Valid watcher did not start');
    rejected.push(await invalid('watch stop array', () => fs.watchStop(['invalid'])));
    await new Promise(resolve => setTimeout(resolve, 100));
    await fs.write(rootId, 'valid.txt', 'round-trip');
    for (let attempt = 0; attempt < 50 && changed.length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const content = await fs.read(rootId, 'valid.txt');
    await fs.watchStop(watchId);
    unsubscribe();
    await fs.revokeRoot(rootId);
    return { rejected, content, changed: changed.length };
  }, rootId);
  assert.equal(results.content, 'round-trip');
  assert(results.changed > 0, 'Malformed watch-stop did not close the valid watcher');
  assert.equal(await readFile(path.join(fixture, 'keep.txt'), 'utf8'), 'unchanged');
  await assert.rejects(access(path.join(fixture, 'object.txt')), { code: 'ENOENT' });
  const dialogs = await app.evaluate(() => globalThis.__fsSmokeDialogs);
  assert.deepEqual(dialogs, { open: 1, save: 0, message: 0 });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, dialogs, rendererErrors: errors.length }, null, 2));
} finally {
  await app?.close().catch(() => {});
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
  await rm(fixture, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true });
}
