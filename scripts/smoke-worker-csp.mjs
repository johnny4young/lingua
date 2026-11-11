#!/usr/bin/env node
// Run after build:desktop-bundles, or pass a packaged executable built from the
// same output (driven over Chromium CDP, as its fuses refuse the Node inspector). Proves each worker script on the app scheme carries its CSP, that
// Chromium enforces it inside real app workers, and that every runtime still
// boots and applies the network policy for running code.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron, chromium } from '@playwright/test';
import { isolatedCredentialStoreArgs } from './lib/electronLaunchArgs.mjs';
import { RUNTIME_WORKER_CSP, WORKER_ENTRY_CSP } from '../src/main/workerCsp.ts';

const root = process.cwd();
const packaged = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const rendererDir = path.join(root, '.vite/renderer/main_window');
const artifacts = path.join(root, 'output/playwright/worker-csp');
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(path.join(artifacts, 'profile-'));
const errors = [];
const results = {};

const assets = await readdir(path.join(rendererDir, 'assets'));
const builtAsset = pattern => {
  const matches = assets.filter(file => pattern.test(file));
  assert.equal(matches.length, 1, `${pattern} names one built file, found ${matches.join(', ') || 'none'}`);
  return `app://lingua/assets/${matches[0]}`;
};
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const entryUrl = Object.fromEntries(
  Object.keys(WORKER_ENTRY_CSP).map(name => [name, builtAsset(new RegExp(`^${escape(name)}-[A-Za-z0-9_-]{8}\\.js$`))])
);
const duckdbWasmUrl = builtAsset(/^duckdb-eh-[A-Za-z0-9_-]{8}\.wasm$/);
const pageEntryUrl = builtAsset(/^index-[A-Za-z0-9_-]{8}\.js$/);

// Unreachable on purpose: a CSP refusal fires before any connection, a network error after.
const REFUSED_HOST = 'https://127.0.0.1:9';
const BLOCK = { policy: 'block', allowedHosts: [], blockedHosts: [] };
const ALLOW = { policy: 'allow', allowedHosts: [], blockedHosts: [] };

const env = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: undefined,
  LINGUA_RENDERER_URL: undefined,
  LINGUA_SMOKE_USER_DATA_DIR: profile,
};
let app = null;
let child = null;
let browser = null;
let page = null;

async function openWindow() {
  if (!packaged) {
    app = await _electron.launch({
      executablePath: createRequire(import.meta.url)('electron'),
      args: [...isolatedCredentialStoreArgs(), root],
      cwd: root,
      env,
      timeout: 30_000,
    });
    return app.firstWindow();
  }
  child = spawn(
    packaged,
    [...isolatedCredentialStoreArgs(), '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'],
    { env, stdio: ['ignore', 'ignore', 'pipe'] }
  );
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no DevTools endpoint within 30 s')), 30_000);
    child.once('exit', code => reject(new Error(`package exited with ${code}`)));
    child.stderr.on('data', data => {
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(String(data));
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const isApp = candidate => candidate.url().startsWith('app://lingua/index.html');
  return context.pages().find(isApp) ?? context.waitForEvent('page', { predicate: isApp });
}

try {
  page = await openWindow();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', error => errors.push(`page: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`page console: ${message.text()}`);
  });
  page.on('worker', worker =>
    worker.on('console', message => {
      if (message.type() === 'error') errors.push(`${worker.url()}: ${message.text()}`);
    })
  );
  await page.getByTestId('app-chrome').waitFor({ timeout: 60_000 });
  // A fresh profile asks about telemetry first.
  await page.getByTestId('first-run-consent-decline').click();
  await page.getByTestId('first-run-consent-modal').waitFor({ state: 'hidden' });
  assert.ok(page.url().startsWith('app://lingua/'), page.url());

  // 1. The header each built file arrives with.
  const headers = await page.evaluate(async urls => {
    const out = {};
    for (const url of urls) out[url] = (await fetch(url)).headers.get('content-security-policy');
    return out;
  }, [...Object.values(entryUrl), pageEntryUrl, 'app://lingua/index.html', duckdbWasmUrl]);
  for (const [name, url] of Object.entries(entryUrl)) assert.equal(headers[url], WORKER_ENTRY_CSP[name], name);
  assert.equal(headers[pageEntryUrl], RUNTIME_WORKER_CSP, 'other JavaScript gets the runtime floor');
  assert.equal(headers['app://lingua/index.html'], null);
  assert.equal(headers[duckdbWasmUrl], null);
  results.headers = Object.keys(entryUrl).length;

  // 2. What Chromium lets code inside each kind of worker do.
  const probe = async ({ host }) => {
    const violations = [];
    self.addEventListener('securitypolicyviolation', event =>
      violations.push(`${event.effectiveDirective} ${event.blockedURI}`)
    );
    const attempt = async run => {
      try {
        await run();
        return 'ok';
      } catch (error) {
        return error?.name ?? 'Error';
      }
    };
    const emptyModule = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    const outcome = {
      remoteImport: await attempt(() => import(`${host}/m.mjs`)),
      remoteJsonImport: await attempt(() => import(`${host}/d.json`, { with: { type: 'json' } })),
      remoteFont: await attempt(() => new FontFace('probe', `url(${host}/f.woff2)`).load()),
      httpsFetch: await attempt(() => fetch(`${host}/`)),
      // TEST-NET-1: whether the request goes out shows in the violations, not here.
      lanHttpFetch: await attempt(() => fetch('http://192.0.2.1/', { signal: AbortSignal.timeout(1500) })),
      wasm: await attempt(() => WebAssembly.compile(emptyModule)),
      blobModule: await attempt(() =>
        import(URL.createObjectURL(new Blob(['export default 1'], { type: 'text/javascript' })))
      ),
    };
    await new Promise(resolve => setTimeout(resolve, 200));
    return { outcome, violations: violations.sort() };
  };
  const startWorker = async (url, type) => {
    const ready = page.waitForEvent('worker', worker => worker.url() === url);
    await page.evaluate(
      ({ url, type }) => {
        window.__cspProbeWorkers ??= [];
        window.__cspProbeWorkers.push(new Worker(url, { type }));
      },
      { url, type }
    );
    return ready;
  };
  const enforced = {};
  for (const [label, url, type] of [
    ['runtime', entryUrl['js-worker'], 'module'],
    ['sql', entryUrl['duckdb-browser-eh.worker'], 'classic'],
    ['tooling', entryUrl['utility-compute-worker'], 'module'],
  ]) {
    enforced[label] = await (await startWorker(url, type)).evaluate(probe, { host: REFUSED_HOST });
  }
  results.enforced = enforced;
  const blocked = (label, directive) =>
    assert.ok(
      enforced[label].violations.some(entry => entry.startsWith(directive)),
      `${label} reports a ${directive} violation: ${JSON.stringify(enforced[label])}`
    );
  for (const label of ['runtime', 'sql', 'tooling']) {
    assert.notEqual(enforced[label].outcome.remoteImport, 'ok', `${label} refuses a remote module`);
    blocked(label, 'script-src');
    assert.notEqual(enforced[label].outcome.remoteFont, 'ok', `${label} refuses a remote font`);
    blocked(label, 'font-src');
  }
  for (const label of ['runtime', 'sql']) {
    assert.equal(enforced[label].outcome.httpsFetch, 'TypeError', `${label} reaches the network`);
    assert.equal(enforced[label].outcome.wasm, 'ok', `${label} compiles WebAssembly`);
    assert.ok(!enforced[label].violations.some(entry => entry.startsWith('connect-src')), label);
  }
  assert.equal(enforced.runtime.outcome.blobModule, 'ok');
  assert.notEqual(enforced.sql.outcome.blobModule, 'ok');
  assert.notEqual(enforced.tooling.outcome.wasm, 'ok');
  // JSON modules answer to connect-src, so runtime workers still send them; see ARCHITECTURE.md.
  for (const url of [`${REFUSED_HOST}/`, 'http://192.0.2.1/', `${REFUSED_HOST}/d.json`])
    assert.ok(enforced.tooling.violations.includes(`connect-src ${url}`), `tooling refuses ${url}`);

  // 3. Each runtime still runs, through the protocol its runner speaks.
  const talk = (url, type, messages, until, timeoutMs = 120_000) =>
    page.evaluate(
      ({ url, type, messages, until, timeoutMs }) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(url, { type });
          const seen = [];
          const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error(`no ${until} from ${url}: ${JSON.stringify(seen).slice(0, 2000)}`));
          }, timeoutMs);
          let next = 0;
          const send = () => {
            if (next < messages.length) worker.postMessage(messages[next++]);
          };
          worker.addEventListener('error', event => {
            clearTimeout(timer);
            reject(new Error(`${url} failed: ${event.message}`));
          });
          worker.addEventListener('message', event => {
            const data = event.data;
            seen.push(data);
            if (data?.type === 'ready') send();
            if (data?.type === until && (until !== 'done' || next >= messages.length)) {
              clearTimeout(timer);
              worker.terminate();
              resolve(seen.map(entry => ({ type: entry.type, args: entry.args, error: entry.error })));
            } else if (data?.type === 'done') send();
          });
          send();
        }),
      { url, type, messages, until, timeoutMs }
    );
  const consoleText = seen =>
    seen
      .filter(entry => entry.type === 'console' || entry.type === 'error')
      .map(entry => [...(entry.args ?? []), entry.error?.message ?? ''].join(' '))
      .join('\n');

  const js = consoleText(
    await talk(
      entryUrl['js-worker'],
      'module',
      [
        {
          type: 'execute',
          runId: 'js-allow',
          code: `console.log('js:' + (6 * 7));
            console.log('import:' + await import('${REFUSED_HOST}/m.mjs').then(() => 'ok', e => e.name));
            console.log('fetch-allow:' + await fetch('${REFUSED_HOST}/').then(() => 'ok', e => e.message.includes('Lingua') ? 'guard' : e.name));`,
          network: ALLOW,
        },
        {
          type: 'execute',
          runId: 'js-block',
          code: `console.log('fetch-block:' + await fetch('${REFUSED_HOST}/').then(() => 'ok', e => e.message.includes('Lingua') ? 'guard' : e.name));`,
          network: BLOCK,
        },
      ],
      'done'
    )
  );
  for (const line of ['js:42', 'import:TypeError', 'fetch-allow:TypeError', 'fetch-block:guard'])
    assert.ok(js.includes(line), `JavaScript worker: ${line} in ${js}`);
  results.javascript = js;

  const python = consoleText(
    await talk(
      entryUrl['python-worker'],
      'module',
      [
        {
          type: 'execute',
          runId: 'py-allow',
          code: 'from pyodide.code import run_js\nprint("python:", run_js("6 * 7"))',
          network: ALLOW,
        },
        {
          type: 'execute',
          runId: 'py-block',
          code: [
            'from pyodide.http import pyfetch',
            'try:',
            `    await pyfetch("${REFUSED_HOST}/")`,
            'except Exception as error:',
            '    print("fetch-block:", "guard" if "Lingua" in str(error) else type(error).__name__)',
          ].join('\n'),
          network: BLOCK,
        },
      ],
      'done',
      180_000
    )
  );
  for (const line of ['python: 42', 'fetch-block: guard'])
    assert.ok(python.includes(line), `Python worker: ${line} in ${python}`);
  results.python = python;

  const ruby = consoleText(
    await talk(
      entryUrl['ruby-worker'],
      'module',
      [
        { type: 'init' },
        {
          type: 'execute',
          runId: 'rb',
          code: 'require "js"\nputs "ruby:#{JS.eval("return 6 * 7")}"',
          network: ALLOW,
        },
      ],
      'done',
      180_000
    )
  );
  assert.ok(ruby.includes('ruby:42'), `Ruby worker: ${ruby}`);
  results.ruby = ruby;

  // wasm_exec.js comes from the local Go toolchain; a stand-in exercises the same blob script and compile.
  const go = await talk(
    entryUrl['go-worker'],
    'classic',
    [
      {
        type: 'execute',
        runId: 'go',
        timeout: 5000,
        wasmExecJs:
          'globalThis.fs = { writeSync: (fd, buf) => buf.length }; globalThis.Go = class { constructor() { this.importObject = {}; } async run() { console.log("go stand-in ran"); } };',
        wasmBytes: [0, 97, 115, 109, 1, 0, 0, 0],
      },
    ],
    'done'
  );
  assert.deepEqual(go.filter(entry => entry.type === 'error'), [], 'Go worker loads its script and compiles');
  results.go = go.map(entry => entry.type);

  const diff = await talk(
    entryUrl['utility-compute-worker'],
    'module',
    [{ type: 'diff', requestId: 'd', left: 'a\nb', right: 'a\nc', granularity: 'line' }],
    'diff-result'
  );
  results.diff = diff.length;

  results.sql = await page.evaluate(
    ({ url, wasm }) =>
      new Promise((resolve, reject) => {
        const worker = new Worker(url);
        let id = 0;
        const pending = new Map();
        const call = (type, data) =>
          new Promise((done, fail) => {
            const messageId = ++id;
            pending.set(messageId, { done, fail });
            worker.postMessage({ messageId, type, data });
          });
        worker.addEventListener('message', ({ data }) => {
          const entry = pending.get(data.requestId);
          if (!entry || data.type === 'LOG' || data.type === 'INSTANTIATE_PROGRESS') return;
          pending.delete(data.requestId);
          if (data.type === 'ERROR') entry.fail(new Error(String(data.data?.message ?? data.data)));
          else entry.done(data);
        });
        (async () => {
          await call('INSTANTIATE', [wasm, null]);
          await call('OPEN', {});
          const connection = (await call('CONNECT', null)).data;
          const extension = await fetch('app://lingua/duckdb-extensions/v1.4.3/wasm_eh/json.duckdb_extension.wasm');
          const blobUrl = `${URL.createObjectURL(await extension.blob())}#/json.duckdb_extension.wasm`;
          await call('RUN_QUERY', [connection, "SET custom_extension_repository='data:'"]);
          await call('RUN_QUERY', [connection, 'SET autoload_known_extensions=false']);
          await call('RUN_QUERY', [connection, `LOAD '${blobUrl}'`]);
          const result = await call('RUN_QUERY', [connection, `SELECT json_valid('{}') AS ok`]);
          worker.terminate();
          return result.type;
        })().then(resolve, reject);
      }),
    { url: entryUrl['duckdb-browser-eh.worker'], wasm: duckdbWasmUrl }
  );
  assert.equal(results.sql, 'QUERY_RESULT');

  // 4. The editor's own workers keep serving the scratchpad, in both locales.
  await page.addInitScript(() => {
    const language = sessionStorage.getItem('lingua-worker-csp-locale');
    if (!language) return;
    sessionStorage.removeItem('lingua-worker-csp-locale');
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({
        state: { language, suppressTourAutoStart: true, hasCompletedOnboardingFirstRun: true, telemetryConsent: 'declined' },
        version: 3,
      })
    );
  });
  results.editorDiagnostics = {};
  for (const locale of ['en', 'es']) {
    await page.evaluate(value => sessionStorage.setItem('lingua-worker-csp-locale', value), locale);
    await page.reload();
    await page.getByTestId('app-chrome').waitFor({ timeout: 60_000 });
    assert.equal(await page.evaluate(() => document.documentElement.lang), locale);
    await page.getByTestId('empty-state-quick-start-javascript').click();
    await page.locator('.monaco-editor').first().click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
    await page.keyboard.insertText('\nconst = 1;');
    await page.locator('.monaco-editor .squiggly-error').first().waitFor({ timeout: 30_000 });
    const editorWorkers = page.workers().map(worker => worker.url());
    assert.ok(editorWorkers.includes(entryUrl['editor.worker']), 'editor worker running');
    assert.ok(editorWorkers.includes(entryUrl['ts.worker']), 'TypeScript worker running');
    results.editorDiagnostics[locale] = true;
    await page.screenshot({ path: path.join(artifacts, `editor-${locale}.png`) });
  }

  const unexpected = errors.filter(line => !/Failed to load resource|ERR_CONNECTION_REFUSED|127\.0\.0\.1:9|192\.0\.2\.1|Content Security Policy|Mixed Content/.test(line));
  assert.deepEqual(unexpected, [], 'no console errors beyond the probes');
  results.status = 'pass';
} catch (error) {
  await page?.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {});
  results.status = 'fail';
  results.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  results.errors = errors;
  await writeFile(path.join(artifacts, 'result.json'), `${JSON.stringify(results, null, 2)}\n`);
  // The edited scratch would hold a normal quit at its save prompt.
  const processHandle = app?.process() ?? child;
  const running = () => processHandle && processHandle.exitCode === null && processHandle.signalCode === null;
  const exited = ms =>
    new Promise(resolve => {
      if (!running()) return resolve();
      const timer = setTimeout(resolve, ms);
      processHandle.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  if (app) {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
    await Promise.race([app.close(), exited(10_000)]).catch(() => {});
  } else {
    await browser?.close().catch(() => {});
    child?.kill('SIGTERM');
    await exited(10_000);
  }
  if (running()) {
    processHandle.kill('SIGKILL');
    await exited(5000);
  }
  await rm(profile, { recursive: true, force: true });
  console.log(`[worker-csp] ${results.status}${results.error ? `: ${results.error}` : ''}`);
}
