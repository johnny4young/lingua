#!/usr/bin/env node
// Run after build:desktop-bundles. Uses actual main/preload, isolated profiles,
// a loopback renderer fixture and the built file renderer; never the user's app.
import { _electron, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const require = createRequire(import.meta.url);
const executablePath = process.argv[2] ?? require('electron');
const rendererRoot = path.join(root, '.vite/renderer/main_window');
const artifacts = path.join(root, 'output/playwright/shell-navigation');
await mkdir(artifacts, { recursive: true });
const contentTypes = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
};
let redirectArmed = false;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/' && redirectArmed) {
      redirectArmed = false;
      response.writeHead(302, { Location: '/other.html' }).end();
      return;
    }
    const file = path.resolve(
      rendererRoot,
      `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`
    );
    if (!file.startsWith(`${rendererRoot}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    const body = await readFile(file);
    response
      .writeHead(200, {
        'Content-Type': contentTypes[path.extname(file)] ?? 'application/octet-stream',
        ...(path.basename(file).startsWith('lingua-sandbox-')
          ? { 'Content-Security-Policy': "frame-ancestors 'self'" }
          : { 'X-Frame-Options': 'DENY' }),
      })
      .end(body);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const devUrl = `http://127.0.0.1:${server.address().port}/?navigation-smoke=1`;
const results = [];
const sandboxAsset = (await readdir(path.join(rendererRoot, 'assets'))).find(name =>
  /^lingua-sandbox-[\w-]+\.htm$/.test(name)
);
assert(sandboxAsset, 'Independent sandbox asset is present in desktop output');

async function checkSandbox(page, label) {
  const result = await page.evaluate(
    async ({ asset, label }) => {
      const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.hidden = true;
      const token = crypto.randomUUID();
      const url = new URL(`./assets/${asset}`, location.href);
      url.searchParams.set('load', token);
      try {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            window.removeEventListener('message', receive);
            reject(new Error('Sandbox handshake timed out'));
          }, 10000);
          function receive(event) {
            if (event.source !== frame.contentWindow || event.origin !== 'null') return;
            if (event.data?.type === 'lingua-sandbox-ready' && event.data.token === token) {
              frame.contentWindow.postMessage(
                {
                  type: 'lingua-sandbox-document',
                  token,
                  html: `<script>let blocked = false; try { parent.document.body.dataset.breached = 'yes'; } catch { blocked = true; } parent.postMessage({ type: 'smoke-result', token: ${JSON.stringify(token)}, blocked, origin: window.origin }, '*');</script>`,
                },
                '*'
              );
            } else if (event.data?.type === 'smoke-result' && event.data.token === token) {
              clearTimeout(timer);
              window.removeEventListener('message', receive);
              resolve({
                policy,
                label,
                blocked: event.data.blocked,
                origin: event.data.origin,
                breached: document.body.dataset.breached,
              });
            }
          }
          window.addEventListener('message', receive);
          frame.src = url.href;
          document.body.append(frame);
        });
      } finally {
        frame.remove();
      }
    },
    { asset: sandboxAsset, label }
  );
  assert.equal(result.blocked, true);
  assert.equal(result.origin, 'null');
  assert.equal(result.breached, undefined);
  const scriptPolicy = result.policy.split(';').find(part => part.trim().startsWith('script-src '));
  assert(!scriptPolicy.includes("'unsafe-inline'"));
  assert(scriptPolicy.includes("'sha256-"));
  results.push(result);
}

try {
  for (const mode of ['file', 'loopback']) {
    const profile = await mkdtemp(path.join(artifacts, `${mode}-profile-`));
    let app;
    try {
      app = await _electron.launch({
        executablePath,
        args: [root],
        cwd: root,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: undefined,
          LINGUA_RENDERER_URL: mode === 'loopback' ? devUrl : undefined,
          LINGUA_SMOKE_USER_DATA_DIR: profile,
        },
        timeout: 30_000,
      });
      const page = await app.firstWindow();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.getByTestId('app-chrome').waitFor({ timeout: 60_000 });
      const originalUrl = page.url();
      assert.equal(new URL(originalUrl).protocol, mode === 'file' ? 'file:' : 'http:');
      await app.evaluate(({ BrowserWindow }) => {
        globalThis.__navigationSmokeEvents = [];
        const contents = BrowserWindow.getAllWindows()[0].webContents;
        for (const name of ['will-navigate', 'will-redirect']) {
          contents.on(name, event =>
            globalThis.__navigationSmokeEvents.push({
              name,
              url: event.url,
              prevented: event.defaultPrevented,
            })
          );
        }
      });
      for (const language of ['en', 'es']) {
        await page.evaluate(language => {
          const settings = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{}}');
          settings.state.language = language;
          settings.state.editorTheme = language === 'en' ? 'lingua-light' : 'lingua-dark';
          localStorage.setItem('lingua-settings', JSON.stringify(settings));
        }, language);
        await page.reload();
        await page.getByTestId('app-chrome').waitFor();
        await checkSandbox(page, `${mode}-${language}`);
        await page.evaluate(() => {
          location.hash = 'navigation-smoke';
        });
        assert.equal(new URL(page.url()).hash, '#navigation-smoke');
        const targets =
          mode === 'file'
            ? [
                'file:///tmp/lingua-untrusted.html',
                originalUrl.replace('index.html', 'other.html'),
                `${originalUrl}?unexpected=1`,
              ]
            : [
                new URL('/other.html', originalUrl).href,
                new URL('/?unexpected=1', originalUrl).href,
                'file:///tmp/lingua-untrusted.html',
              ];
        for (const target of targets) {
          console.log('Navigation probe:', mode, language, target);
          // Cross-scheme file links from HTTP are blocked by Chromium itself;
          // keep that policy covered by unit tests without expecting our event.
          if (mode === 'loopback' && target.startsWith('file:')) continue;
          const before = await app.evaluate(() => globalThis.__navigationSmokeEvents.length);
          await page.evaluate(target => {
            const a = document.createElement('a');
            a.href = target;
            document.body.append(a);
            a.click();
            a.remove();
          }, target);
          await expect
            .poll(() => app.evaluate(() => globalThis.__navigationSmokeEvents.length))
            .toBeGreaterThan(before);
          const event = await app.evaluate(() => globalThis.__navigationSmokeEvents.at(-1));
          assert.equal(event.prevented, true, JSON.stringify(event));
          assert.equal(page.url(), `${originalUrl}#navigation-smoke`);
          // Playwright's locator auto-wait can wait for a cancelled loader.
          // Check the surviving document; a final reload also proves recovery.
          assert(
            await page.evaluate(() => Boolean(document.querySelector('[data-testid="app-chrome"]')))
          );
          results.push({ mode, language, target, event });
        }
        await page.screenshot({ path: path.join(artifacts, `${mode}-${language}.png`) });
      }
      if (mode === 'loopback') {
        redirectArmed = true;
        await page.evaluate(target => {
          location.href = target;
        }, originalUrl);
        await expect
          .poll(() =>
            app.evaluate(() =>
              globalThis.__navigationSmokeEvents.some(event => event.name === 'will-redirect')
            )
          )
          .toBe(true);
        const event = await app.evaluate(() =>
          globalThis.__navigationSmokeEvents.find(event => event.name === 'will-redirect')
        );
        assert.equal(event.prevented, true);
        assert(
          await page.evaluate(() => Boolean(document.querySelector('[data-testid="app-chrome"]')))
        );
        results.push({ mode, event });
      }
      await page.reload();
      await page.getByTestId('app-chrome').waitFor();
      assert.deepEqual(errors, []);
      results.push({ mode, consoleErrors: errors.length });
    } finally {
      await writeFile(path.join(artifacts, 'progress.json'), JSON.stringify(results, null, 2));
      if (app) {
        await app
          .evaluate(({ BrowserWindow }) => {
            for (const window of BrowserWindow.getAllWindows()) window.destroy();
          })
          .catch(() => {});
        await app.close();
      }
      await rm(profile, { recursive: true, force: true });
    }
  }
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify(results, null, 2));
  console.log(
    'Shell security smoke passed: file + loopback, EN/ES, hashed shell CSP, independent opaque sandbox execution, exact-document reload/hash, denied foreign document/query and server redirect, zero console errors.'
  );
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
