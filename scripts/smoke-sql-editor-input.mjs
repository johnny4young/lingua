#!/usr/bin/env node
/** Real native SQL-editor regression; synthetic text and a fresh owned profile only. */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';
import { build, preview } from 'vite';
import { _electron } from 'playwright';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url),
  args = process.argv.slice(2);
let executable = require('electron'),
  profilePair;
for (let index = 0; index < args.length; index += 2) {
  if (args[index] === '--electron-executable' && args[index + 1])
    executable = path.resolve(args[index + 1]);
  else if (args[index] === '--profile-pair' && ['0', '125'].includes(args[index + 1]))
    profilePair = Number(args[index + 1]);
  else
    throw new Error(
      'Usage: node scripts/smoke-sql-editor-input.mjs [--electron-executable /verified/official/Electron] [--profile-pair 0|125]'
    );
}
if (
  typeof executable !== 'string' ||
  !['Electron', 'electron', 'electron.exe', 'Electron.exe'].includes(path.basename(executable)) ||
  !existsSync(executable)
)
  throw new Error(
    'Use the verified official project Electron test binary, never an installed Lingua app'
  );
executable = realpathSync(executable);
const root = mkdtempSync(path.join(os.tmpdir(), 'lingua-sql-input-'));
for (const folder of [
  'home',
  'cache',
  'config',
  'data',
  'tmp',
  'evidence',
  'profile/user-data',
  'profile/session-data',
  'profile/logs',
  'profile/crashes',
  'profile/app-data',
])
  mkdirSync(path.join(root, folder), { recursive: true });
const fixture = path.join(repo, 'tests/__fixtures__/sql-editor-input'),
  configFile = path.join(fixture, 'vite.config.mts');
process.env.LINGUA_SQL_EDITOR_FIXTURE_ROOT = root;
const report = {
  status: 'not-run',
  cases: [],
  externalEdits: [],
  safety: [],
  samples: [],
  errors: [],
  denied: [],
  versions: {
    node: process.version,
    electron: require('electron/package.json').version,
    playwright: require('playwright/package.json').version,
    react: require('react/package.json').version,
    monaco: require('monaco-editor/package.json').version,
  },
  artifactDirectory: root,
};
let server, proxy, app, nativeProcess;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await build({ configFile, logLevel: 'warn' });
  server = await preview({ configFile, logLevel: 'warn' });
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Owned preview unavailable');
  const origin = 'http://127.0.0.1:' + address.port;
  proxy = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (url.origin !== origin || !['GET', 'HEAD'].includes(req.method)) {
      report.denied.push({ method: req.method, origin: url.origin });
      res.writeHead(403).end();
      return;
    }
    const request = http.request(
      url,
      { method: req.method, headers: { ...req.headers, host: url.host } },
      response => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      }
    );
    request.on('error', () => res.writeHead(502).end());
    request.end();
  });
  proxy.on('connect', (req, socket) => {
    report.denied.push({ method: 'CONNECT', target: req.url });
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const nonce = randomUUID();
  writeFileSync(
    path.join(root, 'fixture.json'),
    JSON.stringify({
      nonce,
      origin,
      electron: report.versions.electron,
      proxy: 'http://127.0.0.1:' + proxy.address().port,
    })
  );
  const env = {
    PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
    HOME: path.join(root, 'home'),
    TMPDIR: path.join(root, 'tmp'),
    XDG_CACHE_HOME: path.join(root, 'cache'),
    XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: path.join(root, 'data'),
    LANG: 'en_US.UTF-8',
    TZ: 'UTC',
    LINGUA_SQL_EDITOR_FIXTURE_ROOT: root,
    LINGUA_SQL_EDITOR_FIXTURE_NONCE: nonce,
  };
  if (process.platform === 'win32') env.SystemRoot = process.env.SystemRoot;
  app = await _electron.launch({
    executablePath: executable,
    args: [
      path.join(fixture, 'electron.mjs'),
      '--use-mock-keychain',
      '--password-store=basic',
      '--disable-background-networking',
      ...(profilePair === undefined
        ? []
        : [
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
          ]),
    ],
    cwd: repo,
    env,
    timeout: 20000,
  });
  nativeProcess = app.process();
  const page = await app.firstWindow();
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push(message.text());
  });
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.waitForURL(origin + '/');
  await page.locator('#phase').waitFor({ state: 'visible' });
  const waitReady = async () => {
    const end = Date.now() + 15000;
    while ((await page.locator('#phase').textContent()) !== 'typing-ready') {
      if (Date.now() > end) throw new Error('Editor readiness timeout');
      await sleep(20);
    }
  };
  const dump = async () => {
    await page.locator('#dump').click();
    return JSON.parse(await page.locator('#snapshot').textContent());
  };
  const type = async () => {
    await page
      .locator('[data-testid="sql-query-editor-monaco"] .monaco-editor .overflow-guard')
      .click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type('SELECT 424201 AS answer');
  };
  if (profilePair === undefined) {
    for (const mode of ['idle', 'locale', 'save450', 'save490'])
      for (let trial = 1; trial <= 3; trial++) {
        await page.locator('#reset-' + mode).click();
        await waitReady();
        await type();
        await sleep(1100);
        const snapshot = await dump();
        await page.locator('[data-testid="sql-query-editor-run"]').click();
        const afterRun = await dump();
        const run = afterRun.events.filter(event => event.kind === 'run.request').at(-1);
        const expected = 'SELECT 424201 AS answer',
          exact =
            snapshot.model === expected &&
            snapshot.saved === expected &&
            snapshot.persisted === expected &&
            run?.source === expected;
        const beforeKey = snapshot.events.filter(
          event =>
            event.kind === 'dom.keydown' &&
            event.key?.length === 1 &&
            !event.metaKey &&
            !event.ctrlKey
        );
        const publishedBeforeNextKey =
          beforeKey.length === expected.length &&
          beforeKey.every(event => event.committedText === event.modelBeforeKey);
        report.cases.push({
          mode,
          trial,
          expected,
          exact: exact && publishedBeforeNextKey,
          publishedBeforeNextKey,
          snapshot,
          run,
        });
      }
    for (const language of ['en', 'es']) {
      if (language === 'es') {
        await page.locator('#reset-locale').click();
        await waitReady();
        await type();
        await sleep(1100);
      }
      const label = await page.locator('[data-testid="sql-query-editor-run"]').textContent();
      await page.screenshot({ path: path.join(root, 'evidence', 'editor-' + language + '.png') });
      const before = await dump();
      await page.locator('#predicate').click();
      await sleep(1100);
      const snapshot = await dump(),
        expected = before.model + ' /* synthetic */';
      report.externalEdits.push({
        language,
        label,
        expected,
        exact:
          snapshot.model === expected &&
          snapshot.saved === expected &&
          snapshot.persisted === expected &&
          label.includes(language === 'es' ? 'Ejecutar' : 'Run'),
        snapshot,
      });
    }
    const state = () =>
      page.evaluate(() => ({
        model: globalThis.__qaEditor?.getValue(),
        queries:
          JSON.parse(localStorage.getItem('lingua-workspace-sql-state') ?? '{}').state?.queries ??
          [],
      }));
    const reset = async () => {
      await page.reload();
      await page.locator('#phase').waitFor({ state: 'visible' });
      await page.locator('#reset-idle').click();
      await waitReady();
    };
    await reset();
    const fresh = 'SELECT 707 AS current';
    const immediate = await page.evaluate(text => {
      globalThis.__qaEvents.length = 0;
      globalThis.__qaEditor.setValue(text);
      document.querySelector('[data-testid="sql-query-editor-run"]').click();
      return globalThis.__qaEvents
        .filter(event => event.kind === 'run.request')
        .map(event => event.source);
    }, fresh);
    report.safety.push({
      mode: 'same-task-toolbar-run',
      exact: immediate.length === 1 && immediate[0] === fresh,
      expected: fresh,
      actual: immediate,
    });
    await reset();
    const oversized = 'SELECT 1; /*' + 'x'.repeat(256 * 1024) + '*/';
    const capped = await page.evaluate(text => {
      globalThis.__qaEvents.length = 0;
      globalThis.__qaEditor.setValue(text);
      document.querySelector('[data-testid="sql-query-editor-run"]').click();
      return globalThis.__qaEvents.filter(event => event.kind === 'run.request').length;
    }, oversized);
    report.safety.push({
      mode: 'same-task-over-cap-run',
      exact: capped === 0,
      bytes: Buffer.byteLength(oversized),
      actualRunCount: capped,
    });
    await reset();
    const outgoing = 'SELECT 808 AS outgoing',
      incoming = 'SELECT 909 AS incoming';
    const switchedId = await page.evaluate(
      ({ outgoing, incoming }) => {
        globalThis.__qaEditor.setValue(outgoing);
        return globalThis.__qaSwitchSameInstance(incoming);
      },
      { outgoing, incoming }
    );
    await sleep(650);
    const switched = await state();
    report.safety.push({
      mode: 'same-task-query-switch',
      exact:
        switched.model === incoming &&
        switched.queries.find(q => q.id === switchedId)?.query === incoming &&
        switched.queries.some(q => q.id !== switchedId && q.query === outgoing),
      actual: switched,
    });
    await reset();
    const departing = 'SELECT 1010 AS departing';
    await page.evaluate(text => {
      globalThis.__qaEditor.setValue(text);
      globalThis.__qaUnmount();
    }, departing);
    const unmounted = await state();
    report.safety.push({
      mode: 'same-task-unmount',
      exact: unmounted.queries[0]?.query === departing,
      expected: departing,
      actual: unmounted.queries,
    });
  } else {
    // Metrics stop after the actual save; serialization/dump work is outside the CPU window.
    const cdp = await app.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = async () =>
      Object.fromEntries(
        (await cdp.send('Performance.getMetrics')).metrics.map(row => [row.name, row.value])
      );
    for (const cache of ['cold', 'warm']) {
      await page.locator('#reset-idle').click();
      await waitReady();
      await page.locator('[data-testid="sql-query-editor-monaco"] .overflow-guard').click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await sleep(60);
      const before = await page.evaluate(() => ({
        at: performance.now(),
        commits: window.__bank.commits,
        timelineIndex: window.__bank.timeline.length,
        baselineCommit: window.__bank.timeline.at(-1),
        resources: performance.getEntriesByType('resource').length,
      }));
      const beforeMetrics = await metrics();
      const expected = 'SELECT 424201 AS answer';
      await page.keyboard.type(expected, { delay: profilePair });
      const afterMetrics = await metrics();
      const after = await page.evaluate(() => ({
        at: performance.now(),
        commits: window.__bank.commits,
      }));
      await sleep(650);
      await page.waitForFunction(text => globalThis.__qaSavedText === text, expected, {
        polling: 50,
        timeout: 5000,
      });
      const settledMetrics = await metrics();
      const settled = await page.evaluate(() => ({
        at: performance.now(),
        commits: window.__bank.commits,
        timeline: window.__bank.timeline.slice(),
        resources: performance.getEntriesByType('resource').length,
      }));
      const snapshot = await dump();
      const keydowns = snapshot.events.filter(
        event =>
          event.kind === 'dom.keydown' &&
          event.key?.length === 1 &&
          !event.metaKey &&
          !event.ctrlKey
      );
      const rootTimeline = settled.timeline.slice(before.timelineIndex);
      const modelChanges = snapshot.events.filter(
        event => event.kind === 'model.change' && event.at >= before.at
      );
      const latencies = modelChanges.map(event => {
        const commit = rootTimeline.find(
          row => row.at >= event.at && row.strings[0] === event.value
        );
        return {
          modelAt: event.at,
          published: Boolean(commit),
          latencyMs: commit ? commit.at - event.at : null,
        };
      });
      let previous = before.baselineCommit;
      const causes = { textAndCursor: 0, textOnly: 0, cursorOnly: 0, other: 0 };
      for (const commit of rootTimeline) {
        const text = commit.strings[0] !== previous?.strings?.[0];
        const cursor = JSON.stringify(commit.cursors) !== JSON.stringify(previous?.cursors);
        causes[
          text && cursor ? 'textAndCursor' : text ? 'textOnly' : cursor ? 'cursorOnly' : 'other'
        ]++;
        previous = commit;
      }
      report.samples.push({
        cache,
        delay: profilePair,
        expected,
        model: snapshot.model,
        saved: snapshot.saved,
        persisted: snapshot.persisted,
        exact:
          snapshot.model === expected &&
          snapshot.saved === expected &&
          snapshot.persisted === expected,
        publicationBeforeNextKey:
          keydowns.length === expected.length &&
          keydowns.every(event => event.committedText === event.modelBeforeKey),
        observerSupported: rootTimeline.some(row => row.strings.length && row.cursors.length),
        typingRootCommits: after.commits - before.commits,
        settledRootCommits: settled.commits - before.commits,
        typingTaskCpuMs: (afterMetrics.TaskDuration - beforeMetrics.TaskDuration) * 1000,
        settledTaskCpuMs: (settledMetrics.TaskDuration - beforeMetrics.TaskDuration) * 1000,
        settledScriptCpuMs: (settledMetrics.ScriptDuration - beforeMetrics.ScriptDuration) * 1000,
        settledElapsedMs: settled.at - before.at,
        resourceRequests: settled.resources - before.resources,
        causes,
        latencies,
        before,
        after,
        settled,
        beforeMetrics,
        afterMetrics,
        settledMetrics,
        rootTimeline,
        modelTimeline: snapshot.events,
      });
    }
    await cdp.detach();
  }

  report.status =
    report.cases.every(row => row.exact) &&
    report.safety.every(row => row.exact) &&
    report.samples.every(
      row => row.exact && row.publicationBeforeNextKey && row.observerSupported
    ) &&
    report.externalEdits.every(row => row.exact) &&
    report.errors.length === 0
      ? 'passed'
      : 'failed';
} catch (error) {
  report.status = 'harness-failed';
  report.error = String(error);
} finally {
  if (app)
    try {
      await app.close();
      if (nativeProcess.exitCode === null && nativeProcess.signalCode === null)
        await Promise.race([
          new Promise(resolve => nativeProcess.once('exit', resolve)),
          sleep(3000),
        ]);
      report.nativeExit = { code: nativeProcess.exitCode, signal: nativeProcess.signalCode };
      if (nativeProcess.exitCode !== 0) report.status = 'harness-failed';
    } catch (error) {
      report.closeError = String(error);
      report.status = 'harness-failed';
    }
  if (proxy) {
    proxy.closeAllConnections();
    await new Promise(resolve => proxy.close(resolve));
  }
  if (server) {
    server.httpServer.closeAllConnections();
    await new Promise(resolve => server.httpServer.close(resolve));
  }
  const file = path.join(root, 'evidence/containment.json');
  if (existsSync(file)) report.containment = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        status: report.status,
        typingPassed: report.cases.filter(row => row.exact).length,
        typingTotal: report.cases.length,
        effectPassed: report.externalEdits.filter(row => row.exact).length,
        effectTotal: report.externalEdits.length,
        safetyPassed: report.safety.filter(row => row.exact).length,
        safetyTotal: report.safety.length,
        samples: report.samples.length,
        errors: report.errors,
        error: report.error,
        nativeExit: report.nativeExit,
        artifactDirectory: root,
      },
      null,
      2
    )
  );
}
// Retain only this fixture's owned temporary artifacts for independent inspection.
if (report.status !== 'passed') process.exitCode = 1;
