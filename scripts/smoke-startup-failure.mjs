#!/usr/bin/env node
// Actual Electron/main startup with isolated profiles and synthetic failures.
// Native dialog arguments are captured, not displayed, so this harness can run
// unattended. Normal shell rendering is covered by smoke-shell-navigation.mjs.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const require = createRequire(import.meta.url);
const executable = process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? require('electron');
const showDialog = process.argv.find(arg => arg.startsWith('--show-dialog='))?.split('=')[1];
if (showDialog && !['en', 'es'].includes(showDialog))
  throw new Error('Use --show-dialog=en or --show-dialog=es');
const artifacts = path.join(root, 'output/playwright/startup-failure');
await mkdir(artifacts, { recursive: true });
const results = [];
try {
  for (const scenario of showDialog
    ? ['initialization']
    : [
        'secondary-instance',
        'initialization',
        'missing-renderer',
        'hanging-renderer',
        'quit-during-load',
      ]) {
    for (const language of showDialog
      ? [showDialog]
      : ['secondary-instance', 'hanging-renderer', 'quit-during-load'].includes(scenario)
        ? ['en']
        : ['en', 'es']) {
      const fixture = await mkdtemp(path.join(artifacts, 'fixture-'));
      const recordPath = path.join(fixture, 'result.json');
      const config = {
        scenario,
        language,
        showDialog: Boolean(showDialog),
        recordPath,
        missing: path.join(fixture, 'missing.html'),
        main: path.join(root, '.vite/build/main.js'),
      };
      await writeFile(
        path.join(fixture, 'package.json'),
        JSON.stringify({ name: 'lingua-startup-smoke', version: '1.5.1', main: 'main.cjs' })
      );
      await writeFile(
        path.join(fixture, 'main.cjs'),
        `
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const config = ${JSON.stringify(config)};
const result = { scenario: config.scenario, language: config.language, handlers: 0, windows: 0, dialogs: [], exitCode: null };
const save = () => fs.writeFileSync(config.recordPath, JSON.stringify(result));
save();
process.stdin.once('data', () => app.exit(99));
process.once('exit', code => { result.exitCode = code; save(); });
app.getPreferredSystemLanguages = () => [config.language];
const showErrorBox = dialog.showErrorBox.bind(dialog);
dialog.showErrorBox = (title, content) => { result.dialogs.push({ title, content }); save(); if (config.showDialog) showErrorBox(title, content); };
app.on('browser-window-created', () => { result.windows++; save(); });
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (...args) => { result.handlers++; save(); return handle(...args); };
if (config.scenario === 'secondary-instance') app.requestSingleInstanceLock = () => false;
if (config.scenario === 'initialization') app.getVersion = () => { throw Object.assign(new Error('SYNTHETIC_PRIVATE_PATH_AND_TOKEN'), { code: 'EACCES' }); };
if (config.scenario === 'missing-renderer') {
  const load = BrowserWindow.prototype.loadFile;
  BrowserWindow.prototype.loadFile = function () { return load.call(this, config.missing); };
}
if (config.scenario === 'hanging-renderer') {
  BrowserWindow.prototype.loadURL = function () { return new Promise(() => {}); };
}
if (config.scenario === 'quit-during-load') {
  BrowserWindow.prototype.loadFile = function () {
    setTimeout(() => app.quit(), 25);
    return new Promise(() => {});
  };
}
require(config.main);
`
      );
      const child = spawn(executable, [fixture], {
        cwd: root,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: undefined,
          // The development-server deadline keeps the hang scenario short.
          LINGUA_RENDERER_URL:
            scenario === 'hanging-renderer' ? 'http://127.0.0.1:9/' : undefined,
          LINGUA_SMOKE_USER_DATA_DIR: path.join(fixture, 'profile'),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', chunk => {
        stderr += chunk;
      });
      child.stdout.resume();
      child.stdin.on('error', () => {}); // The owned process may exit while its watchdog writes.
      let timedOut = false;
      let forceExit;
      const timeout = setTimeout(
        () => {
          timedOut = true;
          child.stdin.end('exit');
          // A native modal blocks main's event loop, including its stdin handler.
          // Kill only this spawned fixture if graceful watchdog exit cannot run.
          forceExit = setTimeout(() => child.kill('SIGKILL'), 1500);
        },
        showDialog ? 120_000 : scenario === 'hanging-renderer' ? 40_000 : 5000
      );
      try {
        const exitCode = await new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', code => resolve(code));
        });
        const result = {
          ...JSON.parse(await readFile(recordPath, 'utf8')),
          exitCode,
          timedOut,
          stderr,
        };
        results.push(result);
      } finally {
        clearTimeout(timeout);
        clearTimeout(forceExit);
        await rm(fixture, { recursive: true, force: true });
      }
    }
  }
  for (const result of results) {
    assert.equal(result.timedOut, false, JSON.stringify(result));
    if (result.scenario === 'quit-during-load') {
      assert.equal(result.exitCode, 0);
      assert.equal(result.windows, 1);
      assert.deepEqual(result.dialogs, []);
    } else if (result.scenario === 'secondary-instance') {
      assert.equal(result.exitCode, 0);
      assert.equal(result.handlers, 0);
      assert.equal(result.windows, 0);
      assert.deepEqual(result.dialogs, []);
    } else {
      assert.equal(result.exitCode, 1, JSON.stringify(result));
      assert.equal(result.dialogs.length, 1);
      assert(!JSON.stringify(result.dialogs).includes('SYNTHETIC_PRIVATE_PATH_AND_TOKEN'));
      assert.match(
        result.dialogs[0].title,
        result.language === 'es' ? /no pudo iniciar/ : /could not start/
      );
      if (result.scenario === 'hanging-renderer')
        assert.match(result.dialogs[0].content, /renderer-load\/ETIMEDOUT/);
      assert.equal(
        result.windows,
        ['missing-renderer', 'hanging-renderer'].includes(result.scenario) ? 1 : 0
      );
    }
  }
  console.log(
    showDialog
      ? `Native startup dialog (${showDialog}) dismissed; one safe diagnostic and exit 1 confirmed.`
      : 'Startup failure smoke passed: secondary instance stops before registration; initialization and file-load failures and hanging-load deadlines exit once; quit cancels loading with EN/ES safe diagnostics.'
  );
} finally {
  await writeFile(
    path.join(artifacts, showDialog ? `dialog-${showDialog}.json` : 'result.json'),
    JSON.stringify(results, null, 2)
  );
}
