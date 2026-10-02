#!/usr/bin/env node
/** Project navigation on real main/preload/Monaco and stdio; no install or publish. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { get } from 'node:http';
import { pathToFileURL } from 'node:url';
import { _electron, chromium, expect } from 'playwright/test';
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';
import { mintDevLicense } from './dev-license-shared.mjs';
const root = process.cwd();
const packaged = process.argv.includes('--packaged');
const fixtureServers = process.argv.includes('--fixture-servers');
const repeats = process.argv.includes('--repeat-3') ? 3 : 1;
const fixture = await mkdtemp(
  path.join(process.env.LINGUA_SMOKE_FIXTURE_DIR ?? root, '.tmp-lsp-navigation-')
);
const profile = await mkdtemp(path.join(os.tmpdir(), 'lingua-lsp-profile-'));
const license = await mintDevLicense({ tier: 'pro', days: 1 });
const bin = await mkdtemp(path.join(os.tmpdir(), 'lingua-lsp-bin-'));
if (fixtureServers) {
  const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  for (const [name, language] of [
    ['gopls', 'go'],
    ['rust-analyzer', 'rust'],
  ]) {
    const file = path.join(bin, name);
    await writeFile(
      file,
      `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(root, 'tests/__fixtures__/lsp/navigation-server.mjs'))} ${language} "$@"\n`
    );
    await chmod(file, 0o700);
  }
}
const env = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: undefined,
  LINGUA_LICENSE_PUBLIC_KEY_JWK: license.publicKeyJwk,
  VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK: license.publicKeyJwk,
  LINGUA_LICENSE_SERVER_URL: ' ',
  VITE_LINGUA_LICENSE_SERVER_URL: ' ',
  PATH: `${fixtureServers ? bin : (process.env.LINGUA_LSP_HARNESS_BIN ?? bin)}${path.delimiter}${process.env.PATH}`,
};
const port = 5186;
let server, app, page, browser, packagedChild;
const errors = [],
  reports = [];
try {
  for (const [file, content] of Object.entries({
    'go.mod': 'module example.test/fixture\n\ngo 1.24\n',
    'main.go': 'package main\n\nfunc main() { Hello(); Hello() }\n',
    'helper.go': 'package main\n\nfunc Hello() {}\n',
    'Cargo.toml':
      '[package]\nname = "navigation_fixture"\nversion = "0.1.0"\nedition = "2021"\n\n[[bin]]\nname = "fixture"\npath = "main.rs"\n',
    'main.rs': 'mod helper;\nfn main() { helper::hello(); helper::hello(); }\n',
    'helper.rs': 'pub fn hello() {}\n',
  }))
    await writeFile(path.join(fixture, file), content);
  let result = spawnSync(process.execPath, ['scripts/build-desktop-bundles.mjs'], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  assert.equal(result.status, 0, 'Desktop bundles');
  if (packaged) {
    result = spawnSync(
      process.execPath,
      ['node_modules/electron-builder/out/cli/cli.js', '--dir', '-c.mac.identity=-'],
      { cwd: root, env, stdio: 'inherit' }
    );
    assert.equal(result.status, 0, 'Unsigned package');
  } else {
    server = spawn(
      process.execPath,
      [
        'node_modules/vite/bin/vite.js',
        '--config',
        'vite.renderer.config.mts',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--strictPort',
      ],
      { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    server.stdout.on('data', chunk => process.stdout.write(chunk));
    server.stderr.on('data', chunk => process.stderr.write(chunk));
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if (
          await new Promise(resolve => {
            const request = get(`http://127.0.0.1:${port}`, response => {
              response.resume();
              resolve(response.statusCode === 200);
            });
            request.on('error', () => resolve(false));
          })
        ) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    assert(ready, 'Renderer ready');
  }
  if (packaged) {
    const appPath = path.join(
      root,
      'out-builder',
      process.arch === 'arm64' ? 'mac-arm64' : 'mac',
      'lingua.app'
    );
    const fuses = await getCurrentFuseWire(appPath);
    assert.equal(fuses[FuseV1Options.EnableNodeCliInspectArguments], 48);
    assert.equal(fuses[FuseV1Options.RunAsNode], 48);
    assert.equal(fuses[FuseV1Options.OnlyLoadAppFromAsar], 49);
    await writeFile(
      path.join(profile, 'filesystem-approvals.json'),
      JSON.stringify({ version: 1, roots: [fixture], files: [] })
    );
    packagedChild = spawn(
      path.join(appPath, 'Contents/MacOS/lingua'),
      ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'],
      { env: { ...env, LINGUA_SMOKE_USER_DATA_DIR: profile }, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    packagedChild.stdout.resume();
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP startup deadline')), 30_000);
      packagedChild.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      packagedChild.once('exit', code => {
        clearTimeout(timer);
        reject(new Error(`Package exited ${code}`));
      });
      packagedChild.stderr.on('data', data => {
        const text = data.toString();
        process.stderr.write(text);
        const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    page = context.pages()[0] ?? (await context.waitForEvent('page'));
  } else {
    app = await _electron.launch({
      executablePath: createRequire(import.meta.url)('electron'),
      args: [root],
      cwd: root,
      env: {
        ...env,
        LINGUA_SMOKE_USER_DATA_DIR: profile,
        LINGUA_RENDERER_URL: `http://127.0.0.1:${port}`,
      },
    });
    page = await app.firstWindow();
  }
  // CDP drives this disposable app directly. Keep its development window
  // off the user's desktop so concurrent native UI work cannot type into it.
  if (!packaged)
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.hide();
    });
  page.setDefaultTimeout(30_000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.getByTestId('app-chrome').waitFor();
  if (!packaged)
    await app.evaluate(async ({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, fixture);
  for (const locale of Array.from({ length: repeats }, () => ['en', 'es']).flat()) {
    await page.evaluate(
      ({ locale, fixture, packaged }) => {
        localStorage.clear();
        if (packaged)
          localStorage.setItem(
            'lingua-project-store',
            JSON.stringify({
              state: {
                recentProjects: [
                  {
                    id: fixture,
                    name: 'LSP package fixture',
                    rootPath: fixture,
                    openedAt: Date.now(),
                  },
                ],
                currentProject: null,
              },
              version: 1,
            })
          );
        localStorage.setItem(
          'lingua-settings',
          JSON.stringify({
            state: {
              language: locale,
              suppressTourAutoStart: true,
              hasCompletedOnboardingFirstRun: true,
              telemetryConsent: 'declined',
              restoreSessionMode: 'never',
              lastSeenVersion: '1.5.1',
            },
            version: 3,
          })
        );
      },
      { locale, fixture, packaged }
    );
    await page.reload();
    await page.getByTestId('app-chrome').waitFor();
    const activated = await page.evaluate(
      token => window.lingua.license.applyToken(token),
      license.token
    );
    assert(activated.ok);
    assert.equal(
      (await page.evaluate(() => window.lingua.license.getState())).status.kind,
      'active'
    );
    await page.reload();
    await expect(page.getByTestId('license-badge')).toContainText(/PRO/i);
    const dismiss = page.getByRole('button', { name: /close what's new|cerrar novedades/i });
    if (await dismiss.count()) await dismiss.click();
    const declineTelemetry = page.getByRole('button', { name: /^(Decline|Rechazar)$/ });
    if (await declineTelemetry.count()) await declineTelemetry.click();
    if (packaged) {
      const recent = page.getByRole('button', { name: 'LSP package fixture', exact: true });
      if (!(await recent.isVisible()))
        await page.getByRole('button', { name: /Toggle sidebar|Alternar barra lateral/ }).click();
      await recent.click();
    } else {
      await page.keyboard.press('ControlOrMeta+Shift+P');
      await page
        .getByRole('combobox', { name: /command palette|paleta de comandos/i })
        .fill(locale === 'en' ? 'Open project folder' : 'Abrir carpeta de proyecto');
      await page
        .getByRole('option', { name: locale === 'en' ? /Open project folder/ : /Abrir carpeta/ })
        .click();
      if (!(await page.getByTestId('file-tree-file-count').isVisible()))
        await page.getByRole('button', { name: /Toggle sidebar|Alternar barra lateral/ }).click();
    }
    // Open both source models before exercising navigation. Real servers may
    // acknowledge initialize before their workspace analysis is ready; let
    // indexing proceed while the other language's UI is exercised.
    for (const file of ['main.rs', 'main.go'])
      await page.getByRole('treeitem', { name: file, exact: true }).getByRole('button').click();
    for (const language of ['go', 'rust']) {
      const extension = language === 'go' ? 'go' : 'rs';
      const source = await readFile(path.join(fixture, `main.${extension}`), 'utf8');
      const helperDisk = await readFile(path.join(fixture, `helper.${extension}`), 'utf8');
      await page
        .getByRole('treeitem', { name: `helper.${extension}`, exact: true })
        .getByRole('button')
        .click();
      await page.locator('.monaco-editor').first().click();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.insertText(`// unsaved navigation target\n${helperDisk}`);
      await page
        .getByRole('treeitem', { name: `main.${extension}`, exact: true })
        .getByRole('button')
        .click();
      await expect
        .poll(
          async () =>
            (await page.evaluate(language => window.lingua.lsp[language].status(), language)).kind
        )
        .toBe('running');
      const status = await page.evaluate(
        language => window.lingua.lsp[language].status(),
        language
      );
      assert.equal(status.navigation.definition, true);
      assert.equal(status.navigation.references, true);
      const uri = pathToFileURL(path.join(fixture, `main.${extension}`)).href;
      const line = language === 'go' ? 2 : 1;
      const column = source.split('\n')[line].indexOf(language === 'go' ? 'Hello' : 'hello') + 2;
      let raw;
      // Initialize completes before rust-analyzer's workspace indexing. Wait
      // for the dirty sibling snapshot (its shifted declaration range), not
      // merely a positive disk-only answer. Never retry a failed UI action.
      await expect
        .poll(
          async () => {
            raw = await page.evaluate(
              async ({ language, uri, line, column }) =>
                window.lingua.lsp[language].request('textDocument/references', {
                  textDocument: { uri },
                  position: { line, character: column },
                  context: { includeDeclaration: true },
                }),
              { language, uri, line, column }
            );
            return raw.ok &&
              Array.isArray(raw.data) &&
              raw.data.some(
                location =>
                  location.uri?.endsWith(`helper.${extension}`) &&
                  location.range?.start?.line === (language === 'go' ? 3 : 1)
              )
              ? raw.data.length
              : 0;
          },
          { timeout: 30_000 }
        )
        .toBeGreaterThan(0);
      assert(raw.ok, 'Real bridge references after semantic readiness');
      const editor = page.locator('.monaco-editor').first();
      const assertSourceUnchanged = async () =>
        assert.equal(
          (await editor.locator('.view-lines .view-line').allTextContents())
            .map(line => line.replaceAll('\u00a0', ' '))
            .join('\n')
            .trimEnd(),
          source.trimEnd(),
          'The main source remains unchanged during read-only navigation'
        );
      await assertSourceUnchanged();
      await editor.click();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('ArrowLeft');
      for (let i = 0; i < line; i++) await page.keyboard.press('ArrowDown');
      for (let i = 0; i < column; i++) await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Shift+F12');
      await expect(page.locator('.peekview-widget')).toBeVisible();
      await page.keyboard.press('Escape');
      await assertSourceUnchanged();
      await editor.click();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('ArrowLeft');
      for (let i = 0; i < line; i++) await page.keyboard.press('ArrowDown');
      for (let i = 0; i < column; i++) await page.keyboard.press('ArrowRight');
      // Opening dirty sibling buffers may trigger a new analysis epoch.
      // Wait for that semantic snapshot before the single F12 UI action.
      await expect
        .poll(
          async () => {
            const result = await page.evaluate(
              async ({ language, uri, line, column }) =>
                window.lingua.lsp[language].request('textDocument/definition', {
                  textDocument: { uri },
                  position: { line, character: column },
                }),
              { language, uri, line, column }
            );
            return result.ok && JSON.stringify(result.data).includes(`helper.${extension}`);
          },
          { timeout: 30_000 }
        )
        .toBe(true);
      await assertSourceUnchanged();
      await page.keyboard.press('F12');
      await expect(
        page.getByTestId('editor-tab-activation').filter({
          has: page.getByTestId('editor-tab-filename').filter({ hasText: `helper.${extension}` }),
        })
      ).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('.monaco-editor').first()).toContainText(
        /unsaved\s+navigation\s+target/
      );
      assert.equal(
        await readFile(path.join(fixture, `helper.${extension}`), 'utf8'),
        helperDisk,
        'Dirty target was not saved or replaced'
      );
      assert.deepEqual(errors, [], 'No console/page errors');
      reports.push({
        locale,
        language,
        server: status.version,
        definitionOpened: true,
        referencesUi: true,
        dirtyBufferReused: true,
        references: raw.data.length,
      });
    }
  }
  console.log(
    JSON.stringify({ packaged, fixtureServers, reports, consoleErrors: errors.length }, null, 2)
  );
} catch (error) {
  if (page)
    console.log('Failure UI:', (await page.locator('body').innerText()).slice(0, 8000), errors);
  console.error(error);
  throw error;
} finally {
  packagedChild?.kill('SIGTERM');
  const forceExit = setTimeout(() => {
    app?.process().kill('SIGKILL');
    packagedChild?.kill('SIGKILL');
  }, 5000);
  await app?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (packagedChild && packagedChild.exitCode === null && packagedChild.signalCode === null)
    await new Promise(resolve => packagedChild.once('exit', resolve));
  clearTimeout(forceExit);
  if (server && server.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
  await rm(fixture, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true });
  await rm(bin, { recursive: true, force: true });
}
