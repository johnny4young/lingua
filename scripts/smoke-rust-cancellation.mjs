#!/usr/bin/env node
// Real Rust compiler, IPC and UI; disposable signed license and profile, no execution stubs.
import { createRequire } from 'node:module';
import { _electron } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mintDevLicense } from './dev-license-shared.mjs';
import { mkdtemp, mkdir, writeFile, rm, readFile, access, chmod } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

if (process.platform === 'win32') throw new Error('This compiler-wrapper smoke requires POSIX; use Windows CI for tree termination.');
const root = process.cwd();
const license = await mintDevLicense({ tier: 'pro', days: 1, issuedTo: 'rust-smoke@local' });
// A truthy whitespace override also prevents the production config's env-file
// fallback; both verifiers trim it to disabled. Never send dev tokens to an issuer.
const smokeEnv = { ...process.env,
  LINGUA_LICENSE_PUBLIC_KEY_JWK: license.publicKeyJwk,
  VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK: license.publicKeyJwk,
  LINGUA_LICENSE_SERVER_URL: ' ', VITE_LINGUA_LICENSE_SERVER_URL: ' ',
};
const rustc = execFileSync('which', ['rustc'], { encoding: 'utf8' }).trim();
const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const artifacts = path.join(root, 'output/playwright/rust-cancellation');
await mkdir(artifacts, { recursive: true });
const rendererUrl = 'http://127.0.0.1:5188';
const electronBinary = process.argv[2] ?? createRequire(import.meta.url)('electron');
const fixture = await mkdtemp(path.join(root, '.tmp-rust-cancellation-'));
const userData = await mkdtemp(path.join(artifacts, 'desktop-profile-'));
let server;
let app;
let page;
const errors = [];
const results = [];
try {
  execFileSync(process.execPath, ['scripts/build-desktop-bundles.mjs'], { cwd: root, env: smokeEnv, stdio: 'inherit' });
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
    { cwd: root, env: smokeEnv, stdio: ['ignore', 'pipe', 'pipe'] }
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
      ...smokeEnv,
      LINGUA_SMOKE_USER_DATA_DIR: userData,
      LINGUA_RENDERER_URL: rendererUrl,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.locator('[data-testid="app-chrome"]').waitFor({ timeout: 60000 });
  async function waitForFile(file) {
    for (let i = 0; i < 300; i++) {
      try { return await readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Expected fixture file: ${file}`);
  }
  async function assertReaped(pid) {
    for (let i = 0; i < 100; i++) {
      try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Owned process ${pid} still exists`);
  }
  // Actual rustc wrappers deliberately block one preparation phase; Stop must
  // kill the wrapper process tree, not merely suppress its eventual result.
  for (const phase of ['probe', 'compile']) {
    const dir = path.join(fixture, phase);
    await mkdir(dir);
    const marker = path.join(dir, 'pid');
    const unexpected = path.join(dir, 'must-not-run');
    const condition = phase === 'probe' ? '[ "$1" = "--version" ]' : '[ "$1" != "--version" ]';
    await writeFile(path.join(dir, 'rustc'), `#!/bin/sh
if ${condition}; then
  echo $$ > ${quote(marker)}
  printf '%s' "$3" > ${quote(path.join(dir, 'source-path'))}
  while :; do sleep 1; done
fi
exec ${quote(rustc)} "$@"
`);
    await chmod(path.join(dir, 'rustc'), 0o700);
    await page.evaluate(({ dir, unexpected }) => {
      globalThis.__rustPending = window.lingua.rust.run(
        `fn main() { std::fs::write(${JSON.stringify(unexpected)}, "UNEXPECTED").unwrap(); }`,
        { PATH: dir + ':' + '/usr/bin:/bin' }, undefined, 'preparing');
    }, { dir, unexpected });
    const pid = Number((await waitForFile(marker)).trim());
    assert.deepEqual(await page.evaluate(() => window.lingua.rust.stop('preparing')), { stopped: true });
    assert.equal((await page.evaluate(() => globalThis.__rustPending)).kind, 'stopped');
    await assertReaped(pid);
    await assert.rejects(access(unexpected), error => error.code === 'ENOENT');
    if (phase === 'compile') {
      const sourceFile = await readFile(path.join(dir, 'source-path'), 'utf8');
      assert(sourceFile.includes('lingua-rust-'), 'Private compiler directory captured');
      await assert.rejects(access(path.dirname(sourceFile)), error => error.code === 'ENOENT');
    }
    results.push({ phase, stopped: true, processReaped: true, noUserEffect: true });
  }
  const status = await page.evaluate(async token => {
    const { useLicenseStore } = await import('/src/renderer/stores/licenseStore.ts');
    return useLicenseStore.getState().setLicenseToken(token);
  }, license.token);
  assert.equal(status.kind, 'active', `Throwaway signed license verified: ${status.reason ?? status.kind}`);
  for (const language of ['en', 'es']) {
    await page.evaluate(async language => {
      const { useSettingsStore } = await import('/src/renderer/stores/settingsStore.ts');
      useSettingsStore.getState().setLanguage(language);
      useSettingsStore.getState().setTheme(language === 'en' ? 'light' : 'dark');
      useSettingsStore.setState({ nativeExecutionAcknowledged: true, autoRun: false });
    }, language);
    await page.reload();
    await page.getByTestId('app-chrome').waitFor();
    await page.waitForFunction(async () => {
      const { useLicenseStore } = await import('/src/renderer/stores/licenseStore.ts');
      return useLicenseStore.getState().status.kind === 'active';
    });
    for (const name of [/^(Decline|Rechazar)$/, /^(Skip tour|Omitir tour)$/]) {
      const button = page.getByRole('button', { name });
      if (await button.isVisible()) await button.click();
    }
    const marker = path.join(fixture, `runtime-${language}.pid`);
    const source = `fn main() { std::fs::write(${JSON.stringify(marker)}, std::process::id().to_string()).unwrap(); loop { std::thread::sleep(std::time::Duration::from_millis(50)); } }`;
    await page.evaluate(async source => {
      const { useEditorStore, createDefaultTab } = await import('/src/renderer/stores/editorStore.ts');
      const tab = createDefaultTab('rust');
      useEditorStore.getState().addTab({ ...tab, content: source });
    }, source);
    const run = page.getByTestId('action-pill-run');
    await run.click();
    const pid = Number((await waitForFile(marker)).trim());
    await run.click();
    await page.getByTestId('result-panel').locator('[data-run-status="stopped"]').waitFor();
    await assertReaped(pid);
    const tooltip = await page.getByTestId('result-panel').locator('[data-run-status="stopped"]').getAttribute('aria-label');
    assert(tooltip && !tooltip.includes('runtime.statusPill'), 'Localized stopped status');
    results.push({ language, stoppedTooltip: tooltip });
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const zoom of [1, 1.25, 2]) {
        await app.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom), zoom);
        await page.locator('[data-run-status="stopped"]').first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(artifacts, `stopped-${language}-${width}-${zoom}.png`) });
      }
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    async function replaceSource(source) {
      await page.evaluate(async source => {
        const { useEditorStore } = await import('/src/renderer/stores/editorStore.ts');
        const state = useEditorStore.getState();
        state.updateContent(state.activeTabId, source);
      }, source);
    }
    await replaceSource('fn main() { invalid_rust(); }');
    await run.click();
    await page.getByTestId('result-panel').locator('[data-run-status="error"]').waitFor();
    await page.screenshot({ path: path.join(artifacts, `error-${language}.png`) });
    await replaceSource('fn main() { println!("rust recovered"); }');
    await run.click();
    await page.waitForFunction(async () => {
      const { useResultStore } = await import('/src/renderer/stores/resultStore.ts');
      const result = useResultStore.getState();
      return result.runTermination?.kind === 'success' && result.fullOutput.includes('rust recovered');
    });
    results.push({ language, stopped: true, realPidReaped: true, compileError: true, recovery: true });
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ results, errors, packaged: false,
    harness: 'Playwright Electron; actual rustc, main/preload and run/stop UI; disposable signed Pro token' }, null, 2));
} finally {
  await page?.evaluate(() => window.lingua.rust.stop('preparing')).catch(() => {});
  // These tabs belong only to this disposable fixture. Avoid a native unsaved
  // document prompt preventing the harness from closing its own app.
  await page?.evaluate(async () => {
    const { useEditorStore } = await import('/src/renderer/stores/editorStore.ts');
    useEditorStore.setState(state => ({ tabs: state.tabs.map(tab => ({ ...tab, isDirty: false })) }));
  }).catch(() => {});
  await app?.close().catch(() => {});
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
  await rm(fixture, { recursive: true, force: true });
  await rm(userData, { recursive: true, force: true });
}

console.log('Rust cancellation smoke passed: probe, compile, real binary, EN/ES UI error/recovery, zero console errors');
