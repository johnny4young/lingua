#!/usr/bin/env node
/** Real hardened package via Chromium CDP: no Node inspector or fuse changes. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium, expect } from 'playwright/test';
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';
import { mintDevLicense } from './dev-license-shared.mjs';
const root = process.cwd();
const fixture = await mkdtemp(path.join(process.env.LINGUA_SMOKE_FIXTURE_DIR ?? root, '.tmp-notebook-package-'));
const profile = await mkdtemp(path.join(os.tmpdir(), 'lingua-notebook-package-'));
const license = await mintDevLicense({ tier: 'pro', days: 1 });
const env = { ...process.env, ELECTRON_RUN_AS_NODE: undefined,
  LINGUA_SMOKE_USER_DATA_DIR: profile, LINGUA_LICENSE_PUBLIC_KEY_JWK: license.publicKeyJwk,
  VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK: license.publicKeyJwk,
  LINGUA_LICENSE_SERVER_URL: ' ', VITE_LINGUA_LICENSE_SERVER_URL: ' ' };
let child, browser, watchdog, page;
const errors = [], reports = [];
try {
  for (const args of [['scripts/build-desktop-bundles.mjs'], ['node_modules/electron-builder/out/cli/cli.js', '--dir', '-c.mac.identity=-']]) {
    assert.equal(spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' }).status, 0);
  }
  const appPath = path.join(root, 'out-builder', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'lingua.app');
  const fuses = await getCurrentFuseWire(appPath);
  assert.equal(fuses[FuseV1Options.EnableNodeCliInspectArguments], 48);
  assert.equal(fuses[FuseV1Options.RunAsNode], 48);
  assert.equal(fuses[FuseV1Options.OnlyLoadAppFromAsar], 49);
  await writeFile(path.join(profile, 'filesystem-approvals.json'), JSON.stringify({ version: 1, roots: [fixture], files: [] }));
  child = spawn(path.join(appPath, 'Contents/MacOS/lingua'), ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.resume();
  watchdog = setTimeout(() => child.kill('SIGTERM'), 180_000);
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP startup deadline')), 30_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Package exited ${code}`)); });
    child.stderr.on('data', data => { const text = data.toString(); process.stderr.write(text); const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
  });
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? await context.waitForEvent('page');
  page.setDefaultTimeout(30_000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.getByTestId('app-chrome').waitFor();
  // Seed only during the next document's initialization. A late persist from
  // the old renderer must not overwrite consent/onboarding/license settings.
  await page.getByTestId('first-run-consent-decline').click();
  await expect(page.getByTestId('first-run-consent-modal')).not.toBeVisible();
  await page.addInitScript(() => {
    const raw = sessionStorage.getItem('lingua-notebook-package-next-seed');
    if (!raw) return;
    sessionStorage.removeItem('lingua-notebook-package-next-seed');
    const { locale, fixture, token } = JSON.parse(raw);
    localStorage.clear();
    localStorage.setItem('lingua-settings', JSON.stringify({ state: { language: locale, suppressTourAutoStart: true, hasCompletedOnboardingFirstRun: true, restoreSessionMode: 'always', telemetryConsent: 'declined', lastSeenVersion: '1.5.1' }, version: 3 }));
    localStorage.setItem('lingua-license', JSON.stringify({ state: { token }, version: 0 }));
    localStorage.setItem('lingua-project-store', JSON.stringify({ state: { recentProjects: [{ id: fixture, name: 'Notebook package fixture', rootPath: fixture, openedAt: Date.now() }], currentProject: null }, version: 1 }));
  });
  for (const locale of ['en', 'es']) {
    const file = path.join(fixture, `${locale}.linguanb`);
    const source = JSON.stringify({ format: 'linguanb', documentVersion: 1, notebook: { version: 1, id: 'stable', title: 'Packaged notebook', cells: [{ kind: 'code', id: 'cell', language: 'javascript', source: '1', outputs: [{ kind: 'text', stream: 'stdout', text: 'stale package evidence' }] }] }, executionOrder: { cell: 1 } });
    await writeFile(file, source);
    await page.evaluate(
      seed => sessionStorage.setItem('lingua-notebook-package-next-seed', JSON.stringify(seed)),
      { locale, fixture, token: license.token }
    );
    await page.reload();
    await page.getByTestId('app-chrome').waitFor();
    assert.equal((await page.evaluate(token => window.lingua.license.applyToken(token), license.token)).ok, true);
    assert.equal((await page.evaluate(() => window.lingua.license.getState())).status.kind, 'active');
    await page.reload();
    await expect(page.getByTestId('license-badge')).toContainText(/PRO/i);
    const dismiss = page.getByRole('button', { name: /close what's new|cerrar novedades/i });
    if (await dismiss.count()) await dismiss.click();
    const decline = page.getByRole('button', { name: /^(Decline|Rechazar)$/ });
    if (await decline.count()) await decline.click();
    const recent = page.getByRole('button', { name: 'Notebook package fixture', exact: true });
    if (!(await recent.isVisible())) await page.getByRole('button', { name: /Toggle sidebar|Alternar barra lateral/ }).click();
    await recent.click();
    await page.getByText(`${locale}.linguanb`, { exact: true }).click();
    await expect(page.getByTestId('notebook-view')).toContainText('stale package evidence');
    const row = page.getByTestId('notebook-code-cell-row').first();
    await row.getByTestId('notebook-code-cell-static').click();
    await row.locator('.monaco-editor').click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText('console.log("package saved");');
    await page.getByTestId('notebook-document-save').click();
    // A clean indicator can predate a first save; prove the disk commit itself.
    await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).notebook.cells[0].source)
      .toBe('console.log("package saved");');
    await expect(page.getByTestId('notebook-document-dirty')).toHaveCount(0);
    const saved = await readFile(file, 'utf8');
    assert.equal(JSON.parse(saved).notebook.cells[0].source, 'console.log("package saved");');
    await row.getByTestId('notebook-code-cell-static').click();
    await row.locator('.monaco-editor').click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText('console.log("recover local");');
    await writeFile(file, 'external conflict');
    await page.getByTestId('notebook-document-save').click();
    await expect(page.getByTestId('status-notice-banner')).toContainText(locale === 'en' ? /changed on disk/ : /cambió en disco/);
    await expect(page.getByTestId('notebook-document-dirty')).toBeVisible();
    assert.equal(await readFile(file, 'utf8'), 'external conflict');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('lingua-session') ?? '{}').state?.savedTabs?.some(tab => tab.kind === 'notebook' && tab.notebookTabId && JSON.parse(localStorage.getItem('lingua-notebook-state') ?? '{}').state?.notebooks?.[tab.notebookTabId]?.notebook?.cells?.[0]?.source === 'console.log("recover local");') ?? false)).toBe(true);
    await writeFile(file, saved);
    assert.deepEqual(errors, []);
    await page.reload();
    await expect(page.getByTestId('notebook-view')).toContainText('stale package evidence');
    await expect(page.getByTestId('notebook-document-dirty')).toBeVisible();
    // Disk matches the saved baseline again, so recovery must not claim a conflict.
    await expect(page.getByTestId('status-notice-banner').filter({ hasText: /changed on disk|cambió en disco/ })).toHaveCount(0);
    await page.getByTestId('notebook-code-cell-static').first().click();
    await expect(page.locator('.monaco-editor')).toContainText(/recover\s+local/);
    await page.getByTestId('notebook-document-save').click();
    await expect(page.getByTestId('notebook-document-dirty')).toHaveCount(0);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).notebook.cells[0].source, 'console.log("recover local");');
    assert(!(await readdir(fixture)).some(name => name.endsWith('.tmp')));
    assert.deepEqual(errors, []);
    reports.push({ locale, projectOpen: true, manualSave: true, conflict: true, dirtyRecovery: true, staleOutputs: true });
  }
  console.log(JSON.stringify({ packaged: true, hardenedFusesUnchanged: true, harness: 'Chromium CDP; native approved-root reopen and disk IPC', reports, consoleErrors: errors.length }, null, 2));
} catch (error) {
  if (page) console.log('Failure UI:', (await page.locator('body').innerText()).slice(0, 8000), errors);
  console.error(error);
  throw error;
} finally {
  clearTimeout(watchdog);
  child?.kill('SIGTERM');
  const forceExit = setTimeout(() => child?.kill('SIGKILL'), 5000);
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once('exit', resolve));
  clearTimeout(forceExit);
  await rm(fixture, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true });
}
