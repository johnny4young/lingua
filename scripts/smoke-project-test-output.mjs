#!/usr/bin/env node
// Real main/preload and renderer with an isolated project and explicit picker fixture.
import { createRequire } from 'node:module';
import { _electron } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const artifacts = path.join(root, 'output/playwright/project-test-output-ui');
await mkdir(artifacts, { recursive: true });
const rendererUrl = 'http://127.0.0.1:5187';
const electronBinary = process.argv[2] ?? createRequire(import.meta.url)('electron');
const fixture = await mkdtemp(path.join(root, '.tmp-project-test-output-'));
const userData = await mkdtemp(path.join(artifacts, 'desktop-profile-'));
let server;
let app;
const errors = [];
const results = [];
try {
  await mkdir(path.join(fixture, 'node_modules/vitest'), { recursive: true });
  await writeFile(
    path.join(fixture, 'package.json'),
    JSON.stringify({ devDependencies: { vitest: '*' } })
  );
  await writeFile(
    path.join(fixture, 'node_modules/vitest/vitest.mjs'),
    'process.stdout.write("first\\n"); setTimeout(() => process.stderr.write("warning\\n"), 100); setTimeout(() => process.stdout.write("last\\n"), 200); setTimeout(() => process.exit(1), 2000);'
  );
  server = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      '--config',
      'vite.renderer.config.mts',
      '--host',
      '127.0.0.1',
      '--port',
      '5187',
      '--strictPort',
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  server.stdout.on('data', data => process.stdout.write(data));
  server.stderr.on('data', data => process.stderr.write(data));
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Renderer server exited');
    try {
      if ((await fetch(rendererUrl)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(ready, 'Renderer server ready');
  app = await _electron.launch({
    executablePath: electronBinary,
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      LINGUA_SMOKE_USER_DATA_DIR: userData,
      LINGUA_RENDERER_URL: rendererUrl,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.locator('[data-testid="app-chrome"]').waitFor({ timeout: 60000 });
  await app.evaluate(({ dialog }, fixture) => {
    globalThis.__fixturePickerCalls = 0;
    dialog.showOpenDialog = async () => {
      globalThis.__fixturePickerCalls++;
      return { canceled: false, filePaths: [fixture] };
    };
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  }, fixture);
  for (const language of ['en', 'es']) {
    await page.evaluate(async language => {
      // Use the live owner: raw localStorage edits can be overwritten by a
      // concurrent persisted settings update before reload.
      const { useSettingsStore } = await import('/src/renderer/stores/settingsStore.ts');
      useSettingsStore.getState().setLanguage(language);
      useSettingsStore.getState().setTheme(language === 'en' ? 'light' : 'dark');
    }, language);
    await page.reload();
    await page.locator('[data-testid="app-chrome"]').waitFor();
    const decline = page.getByRole('button', { name: /^(Decline|Rechazar)$/ });
    if (await decline.isVisible()) await decline.click();
    const skipTour = page.getByRole('button', { name: /^(Skip tour|Omitir tour)$/ });
    if (await skipTour.isVisible()) await skipTour.click();
    const picked = await page.evaluate(() => window.lingua.fs.selectDirectory());
    assert(picked, 'Approved fixture root');
    await page.evaluate(async fixture => {
      const { useProjectStore } = await import('/src/renderer/stores/projectStore.ts');
      await useProjectStore.getState().openProject(fixture);
    }, fixture);
    await page.evaluate(async () => {
      const { useSettingsStore } = await import('/src/renderer/stores/settingsStore.ts');
      useSettingsStore.setState({ nativeExecutionAcknowledged: true });
      const { useUIStore } = await import('/src/renderer/stores/uiStore.ts');
      useUIStore.getState().setSidebarVisible(true);
    });
    await page.getByTestId('file-tree-project-tests').click();
    await page.getByTestId('project-tests-overlay').waitFor();
    assert.equal(
      await page.locator('html').getAttribute('data-theme'),
      language === 'en' ? 'light' : 'dark'
    );
    await writeFile(
      path.join(fixture, 'node_modules/vitest/vitest.mjs'),
      'process.stdout.write("first\\n"); setTimeout(() => process.stderr.write("warning\\n"), 100); setTimeout(() => process.stdout.write("last\\n"), 200); setTimeout(() => process.exit(1), 2000);'
    );
    await page.getByTestId('project-tests-run').click();
    await page
      .getByTestId('project-tests-live-ordered')
      .getByText('first', { exact: false })
      .waitFor();
    await page.getByText(language === 'en' ? 'Failed' : 'Fallaron', { exact: true }).waitFor();
    assert.equal(
      await page.getByTestId('project-tests-ordered').textContent(),
      'first\nwarning\nlast\n'
    );
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const zoom of [1, 1.25, 2]) {
        await app.evaluate(
          ({ BrowserWindow }, zoom) =>
            BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom),
          zoom
        );
        await page.waitForTimeout(100);
        await page.getByTestId('project-tests-ordered').scrollIntoViewIfNeeded();
        const visible = await page.getByTestId('project-tests-ordered').evaluate(element => {
          const rect = element.getBoundingClientRect();
          return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= window.innerHeight &&
            rect.right <= window.innerWidth
          );
        });
        assert(visible, 'Observed output remains reachable at this viewport and native zoom');
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: path.join(artifacts, `project-tests-${language}-${width}-${zoom}.png`),
        });
      }
    }
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)
    );
    await writeFile(
      path.join(fixture, 'node_modules/vitest/vitest.mjs'),
      'console.log("recovered");'
    );
    await page.getByTestId('project-tests-run').click();
    await page.getByText(language === 'en' ? 'Passed' : 'Aprobadas', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('project-tests-ordered').textContent(), 'recovered\n');
    results.push({ language, observedOrder: true, failedRun: true, recovery: true });
  }
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(artifacts, 'result.json'),
    JSON.stringify(
      {
        results,
        errors,
        harness:
          'Playwright Electron, real main/preload, synthetic picker fixture, isolated profile',
        packaged: false,
      },
      null,
      2
    )
  );
  console.log(
    'Project test output UI passed real IPC/capture, EN-light/ES-dark, failure/recovery and viewport/zoom matrix with zero console errors'
  );
} finally {
  await app?.close().catch(() => {});
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
  await rm(fixture, { recursive: true, force: true });
  await rm(userData, { recursive: true, force: true });
}
