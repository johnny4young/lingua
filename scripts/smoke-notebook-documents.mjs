#!/usr/bin/env node
/** Manual notebook documents against real Electron disk IPC; never publishes. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron, expect } from 'playwright/test';
import { mintDevLicense } from './dev-license-shared.mjs';

const root = process.cwd();
const packaged = process.argv.includes('--packaged');
if (packaged) {
  await import('./smoke-notebook-packaged.mjs');
  process.exit(0);
}
const license = await mintDevLicense({ tier: 'pro', days: 1 });
const env = {
  ...process.env,
  VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK: license.publicKeyJwk,
  LINGUA_LICENSE_PUBLIC_KEY_JWK: license.publicKeyJwk,
  ELECTRON_RUN_AS_NODE: undefined,
  LINGUA_LICENSE_SERVER_URL: ' ',
  VITE_LINGUA_LICENSE_SERVER_URL: ' ',
};
// Safe project parent: OS temp and private .codex roots cannot mint capabilities.
const fixture = await mkdtemp(
  path.join(process.env.LINGUA_SMOKE_FIXTURE_DIR ?? root, '.tmp-notebook-documents-')
);
const profile = await mkdtemp(path.join(os.tmpdir(), 'lingua-notebook-profile-'));
const url = 'http://127.0.0.1:5188';
let server;
let app;
const errors = [];
const reports = [];
try {
  const build = spawnSync(process.execPath, ['scripts/build-desktop-bundles.mjs'], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  assert.equal(build.status, 0, 'Desktop build');
  if (packaged) {
    const bundle = spawnSync(
      process.execPath,
      ['node_modules/electron-builder/out/cli/cli.js', '--dir', '-c.mac.identity=-'],
      { cwd: root, env, stdio: 'inherit' }
    );
    assert.equal(bundle.status, 0, 'Unsigned disposable desktop package');
  }
  assert(
    (await readFile(path.join(root, '.vite/build/main.js'), 'utf8')).includes(
      JSON.parse(license.publicKeyJwk).x
    ),
    'Main bundle contains this ephemeral verification key'
  );
  if (!packaged) {
    server = spawn(
      process.execPath,
      [
        'node_modules/vite/bin/vite.js',
        '--config',
        'vite.renderer.config.mts',
        '--host',
        '127.0.0.1',
        '--port',
        '5188',
        '--strictPort',
      ],
      { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    server.stdout.on('data', chunk => process.stdout.write(chunk));
    server.stderr.on('data', chunk => process.stderr.write(chunk));
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(url)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert(ready, 'Renderer ready');
  }
  const executablePath = packaged
    ? path.join(
        root,
        'out-builder',
        process.arch === 'arm64' ? 'mac-arm64' : 'mac',
        'lingua.app',
        'Contents',
        'MacOS',
        'lingua'
      )
    : createRequire(import.meta.url)('electron');
  app = await _electron.launch({
    executablePath,
    args: packaged ? [] : [root],
    cwd: root,
    env: {
      ...env,
      LINGUA_SMOKE_USER_DATA_DIR: profile,
      ...(packaged ? {} : { LINGUA_RENDERER_URL: url }),
    },
  });
  const page = await app.firstWindow();
  console.log(
    'Smoke mode enabled:',
    await page.evaluate(() => window.lingua.desktopSmoke?.enabled)
  );
  page.setDefaultTimeout(30_000);
  console.log('Electron window:', page.url());
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page
    .getByTestId('app-chrome')
    .waitFor()
    .catch(async error => {
      console.log('Boot diagnostic:', await page.locator('body').innerText(), errors);
      throw error;
    });
  // Settle the fresh-profile consent UI before seeding/reloading local storage.
  // Otherwise a late first-boot persist can overwrite the seeded declined value.
  await page.getByTestId('first-run-consent-decline').click();
  await expect(page.getByTestId('first-run-consent-modal')).not.toBeVisible();
  await page.addInitScript(() => {
    const raw = sessionStorage.getItem('lingua-notebook-smoke-next-seed');
    if (!raw) return;
    sessionStorage.removeItem('lingua-notebook-smoke-next-seed');
    const { language, token } = JSON.parse(raw);

    localStorage.clear();
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({
        state: {
          language,
          suppressTourAutoStart: true,
          hasCompletedOnboardingFirstRun: true,
          restoreSessionMode: 'always',
          lastSeenVersion: '1.5.1',
          telemetryConsent: 'declined',
        },
        version: 3,
      })
    );
    localStorage.setItem('lingua-license', JSON.stringify({ state: { token }, version: 0 }));
  });
  for (const language of ['en', 'es']) {
    console.log('Notebook locale:', language);
    await page.evaluate(
      seed => sessionStorage.setItem('lingua-notebook-smoke-next-seed', JSON.stringify(seed)),
      { language, token: license.token }
    );
    await page.reload();
    await page.getByTestId('app-chrome').waitFor();
    const activation = await page.evaluate(
      token => window.lingua.license.applyToken(token),
      license.token
    );
    assert.equal(activation.ok, true, 'License token apply action');
    const verifiedStatus = await page.evaluate(
      async () => (await window.lingua.license.getState()).status
    );
    console.log(
      'Verified main license status:',
      verifiedStatus.kind,
      verifiedStatus.reason ?? '',
      verifiedStatus.message ?? ''
    );
    assert.equal(verifiedStatus.kind, 'active', 'Main verified ephemeral license');
    await page.reload();
    await expect(page.getByTestId('license-badge')).toContainText(/PRO/i);
    const whatsNewClose = page.getByRole('button', { name: /close what's new|cerrar novedades/i });
    if (await whatsNewClose.count()) await whatsNewClose.click();
    const original = path.join(fixture, `${language}.linguanb`);
    const saveAs = path.join(fixture, `${language}-copy.linguanb`);
    await writeFile(
      original,
      JSON.stringify({
        format: 'linguanb',
        documentVersion: 1,
        notebook: {
          version: 1,
          id: 'stable',
          title: 'Disk notebook',
          cells: [
            {
              kind: 'code',
              id: 'cell',
              language: 'javascript',
              source: '1',
              outputs: [{ kind: 'text', stream: 'stdout', text: 'stale disk evidence' }],
            },
          ],
        },
        executionOrder: { cell: 1 },
      })
    );
    await app.evaluate(
      ({ dialog }, paths) => {
        dialog.showOpenDialog = async options => ({
          canceled: false,
          filePaths: [
            options.properties?.includes('openDirectory') ? paths.fixture : paths.original,
          ],
        });
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.saveAs });
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      },
      { fixture, original, saveAs }
    );
    // Project tree open (real root capability); no renderer-supplied absolute disk write.
    await page.keyboard.press('ControlOrMeta+Shift+P');
    await page
      .getByRole('combobox', { name: /command palette|paleta de comandos/i })
      .fill(language === 'en' ? 'Open project folder' : 'Abrir carpeta de proyecto');
    await page
      .getByRole('option', { name: language === 'en' ? /Open project folder/ : /Abrir carpeta/ })
      .click();
    if (!(await page.getByTestId('file-tree-file-count').isVisible()))
      await page.getByRole('button', { name: /Toggle sidebar|Alternar barra lateral/ }).click();
    await page.getByText(`${language}.linguanb`, { exact: true }).click();
    await expect(page.getByTestId('notebook-view')).toBeVisible();
    await expect(page.getByTestId('notebook-view')).toContainText('stale disk evidence');
    const row = page.getByTestId('notebook-code-cell-row').first();
    await row.getByTestId('notebook-code-cell-static').click();
    await row.locator('.monaco-editor').click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText('console.log("manual saved");');
    await expect(page.getByTestId('notebook-document-dirty')).toBeVisible();
    await page.getByTestId('notebook-document-save').click();
    await expect(page.getByTestId('notebook-document-dirty')).toHaveCount(0);
    assert.equal(
      JSON.parse(await readFile(original, 'utf8')).notebook.cells[0].source,
      'console.log("manual saved");'
    );
    await row.getByTestId('notebook-code-cell-static').click();
    await row.locator('.monaco-editor').click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText('console.log("keep local");');
    await writeFile(original, 'external file modification');
    await page.getByTestId('notebook-document-save').click();
    await expect(page.getByTestId('status-notice-banner')).toContainText(
      language === 'en' ? /changed on disk/ : /cambió en disco/
    );
    assert.equal(await readFile(original, 'utf8'), 'external file modification');
    await expect(page.getByTestId('notebook-document-dirty')).toBeVisible();
    await page.getByTestId('notebook-document-save-as').click();
    await expect(page.getByTestId('notebook-document-dirty')).toHaveCount(0);
    assert.equal(
      JSON.parse(await readFile(saveAs, 'utf8')).notebook.cells[0].source,
      'console.log("keep local");'
    );
    assert(
      !(await readdir(fixture)).some(name => name.endsWith('.tmp')),
      'No temporary writes leaked'
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('lingua-session') ?? '{}').state?.savedTabs?.some(tab =>
              tab.filePath?.endsWith('-copy.linguanb')
            ) ?? false
        )
      )
      .toBe(true)
      .catch(async error => {
        console.log(
          'Session metadata diagnostic:',
          await page.evaluate(() => ({
            safeMode: localStorage.getItem('lingua-safe-mode'),
            restoreMode: JSON.parse(localStorage.getItem('lingua-settings') ?? '{}').state
              ?.restoreSessionMode,
            tabs: JSON.parse(localStorage.getItem('lingua-session') ?? '{}').state?.savedTabs?.map(
              tab => ({
                name: tab.name,
                filePath: tab.filePath,
                kind: tab.kind,
                isDirty: tab.isDirty,
              })
            ),
          })),
          errors
        );
        throw error;
      });
    assert.deepEqual(errors, [], 'No renderer console or page errors before reload');
    await page.reload();
    await expect(page.getByTestId('notebook-view')).toBeVisible();
    await expect(page.getByTestId('notebook-document-dirty')).toHaveCount(0);
    await expect(page.getByTestId('notebook-view')).toContainText('stale disk evidence');
    reports.push({
      language,
      projectOpen: true,
      manualSave: true,
      conflict: true,
      saveAs: true,
      recovery: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ packaged, reports, consoleErrors: errors.length }, null, 2));
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    console.log('Failure UI:', (await page.locator('body').innerText()).slice(0, 10000), errors);
  }
  throw error;
} finally {
  await app?.close().catch(() => {});
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
  await rm(fixture, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true });
}
