#!/usr/bin/env node
// Run after build:desktop-bundles. Crashes the native Local SQL engine twice with a
// native signal, once idle and once during a query, and checks that the window
// survives, the caller gets engine-gone, and the next open starts a new engine. A
// SQLite connection on the remote SQL host keeps answering throughout, and a cancel
// it cannot honour restarts that host.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { _electron } from '@playwright/test';
import { isolatedCredentialStoreArgs } from './lib/electronLaunchArgs.mjs';

const root = process.cwd();
const executablePath =
  process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? createRequire(import.meta.url)('electron');
const artifacts = path.join(root, 'output/playwright/sql-local-crash');
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(path.join(artifacts, 'profile-'));
const sqliteFile = path.join(await mkdtemp(path.join(artifacts, 'sqlite-')), 'remote.sqlite');
const seed = new DatabaseSync(sqliteFile);
seed.exec('CREATE TABLE t(n INTEGER); INSERT INTO t VALUES (7)');
seed.close();
const errors = [];
const results = {};

const app = await _electron.launch({
  executablePath,
  args: [...isolatedCredentialStoreArgs(), root],
  cwd: root,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, LINGUA_RENDERER_URL: undefined, LINGUA_SMOKE_USER_DATA_DIR: profile },
  timeout: 30_000,
});

const enginePids = () =>
  app.evaluate(({ app: electronApp }) =>
    electronApp
      .getAppMetrics()
      .filter(metric => metric.name === 'Lingua local SQL')
      .map(metric => metric.pid)
  );

async function waitForEngine(previous = []) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pids = (await enginePids()).filter(pid => !previous.includes(pid));
    if (pids.length > 0) return pids[0];
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('No Local SQL engine process appeared');
}

async function waitForExit(pid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!(await enginePids()).includes(pid)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Engine ${pid} kept running`);
}

/** Opens an engine and a connection in the renderer, through the preload bridge. */
const openEngine = page =>
  page.evaluate(async () => {
    const bridge = window.lingua.sqlLocal;
    const opened = await bridge.open(false);
    if (!opened.ok) throw new Error(opened.error.message);
    const connected = await bridge.connect(opened.value.engineId);
    if (!connected.ok) throw new Error(connected.error.message);
    const answer = await bridge.query(connected.value, 'SELECT 42 AS answer');
    return { engineId: opened.value.engineId, connectionId: connected.value, answer: answer.ok ? answer.value.rows[0].answer : answer.error };
  });

/** Runs one statement on the remote SQL host through the preload bridge. */
const remote = (page, connectionId, sql, runId) =>
  page.evaluate(({ connectionId, sql, runId }) => window.lingua.db.execute(runId, connectionId, sql, { timeoutMs: 60_000 }), { connectionId, sql, runId });

try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.getByTestId('app-chrome').waitFor({ timeout: 60_000 });
  assert.equal((await page.evaluate(() => window.lingua.sqlLocal.status())).available, true, 'this build ships the native engine');

  const saved = await page.evaluate(file => window.lingua.db.openAdhoc({ name: 'crash smoke', engine: 'sqlite', path: file, readOnly: true, passwordMode: 'none' }), sqliteFile);
  assert.ok(saved.ok, JSON.stringify(saved));
  const remoteId = saved.connection.id;
  assert.deepEqual((await remote(page, remoteId, 'SELECT n FROM t', 'r1')).rows, [{ n: '7' }]);

  // 1. The idle engine aborts, as a native assertion in DuckDB would.
  const first = await openEngine(page);
  assert.equal(String(first.answer), '42');
  const firstPid = await waitForEngine();
  process.kill(firstPid, 'SIGABRT');
  await waitForExit(firstPid);
  assert.equal(await page.evaluate(() => 1 + 1), 2, 'the window survives');
  const stale = await page.evaluate(id => window.lingua.sqlLocal.connect(id), first.engineId);
  assert.equal(stale.ok ? 'ok' : stale.error.code, 'engine-gone');

  // 2. A native signal ends the engine while a query is in flight.
  const second = await openEngine(page);
  assert.equal(String(second.answer), '42');
  const secondPid = await waitForEngine([firstPid]);
  await page.evaluate(id => {
    window.__crashQuery = window.lingua.sqlLocal.query(id, 'SELECT count(*) FROM range(100000000000)');
  }, second.connectionId);
  await new Promise(resolve => setTimeout(resolve, 300));
  process.kill(secondPid, 'SIGSEGV');
  const inFlight = await page.evaluate(() => window.__crashQuery);
  results.inFlight = inFlight;
  assert.equal(inFlight.ok ? 'ok' : inFlight.error.code, 'engine-gone');
  await waitForExit(secondPid);

  // The remote host never noticed.
  assert.deepEqual((await remote(page, remoteId, 'SELECT n FROM t', 'r2')).rows, [{ n: '7' }]);

  // 3. The next open starts a new engine that answers.
  const third = await openEngine(page);
  assert.equal(String(third.answer), '42');
  results.pids = [firstPid, secondPid, await waitForEngine([firstPid, secondPid])];
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);

  // 4. SQLite blocks its host and cannot be interrupted: Cancel restarts the host, and the next run starts a new one.
  await page.evaluate(id => {
    window.__slowRemote = window.lingua.db.execute('r3', id, 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c', { timeoutMs: 120_000 });
  }, remoteId);
  await new Promise(resolve => setTimeout(resolve, 500));
  const cancelled = await page.evaluate(() => window.lingua.db.cancel('r3'));
  assert.deepEqual(cancelled, { cancelled: true });
  results.cancelledRun = (await page.evaluate(() => window.__slowRemote)).status;
  assert.notEqual(results.cancelledRun, 'success');
  assert.deepEqual((await remote(page, remoteId, 'SELECT n FROM t', 'r4')).rows, [{ n: '7' }]);

  assert.deepEqual(errors, []);
  console.log('Local SQL crash smoke passed:', JSON.stringify(results));
} finally {
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ results, errors }, null, 2));
  await app.close().catch(() => undefined);
  await rm(profile, { recursive: true, force: true });
  await rm(path.dirname(sqliteFile), { recursive: true, force: true });
}
