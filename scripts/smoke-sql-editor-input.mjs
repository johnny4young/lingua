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
if (args.length && !(args.length === 2 && args[0] === '--electron-executable'))
  throw new Error(
    'Usage: node scripts/smoke-sql-editor-input.mjs [--electron-executable /verified/official/Electron]'
  );
let executable = args.length ? path.resolve(args[1]) : require('electron');
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
  errors: [],
  denied: [],
  versions: {
    node: process.version,
    electron: require('electron/package.json').version,
    playwright: require('playwright/package.json').version,
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
      report.cases.push({ mode, trial, expected, exact, snapshot, run });
    }
  for (const language of ['en', 'es']) {
    if (language === 'es') {
      await page.locator('#reset-locale').click();
      await waitReady();
      await type();
      await sleep(1100);
    }
    const label = await page.locator('[data-testid="sql-query-editor-run"]').textContent();
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
  report.status =
    report.cases.every(row => row.exact) &&
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
