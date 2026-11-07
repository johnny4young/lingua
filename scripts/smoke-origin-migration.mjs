#!/usr/bin/env node
// Run after build:desktop-bundles. An older build stored renderer data on the
// file:// origin; this seeds a real profile that way, then proves the current
// build carries it to the app scheme once, never rolls it back, and leaves the
// file:// copy intact. Uses actual main/preload and isolated profiles.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron } from '@playwright/test';
import { isolatedCredentialStoreArgs } from './lib/electronLaunchArgs.mjs';

const root = process.cwd();
const executablePath =
  process.argv.slice(2).find(arg => !arg.startsWith('--')) ??
  createRequire(import.meta.url)('electron');
const artifacts = path.join(root, 'output/playwright/origin-migration');
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(path.join(artifacts, 'profile-'));
const legacyFixture = await mkdtemp(path.join(artifacts, 'legacy-build-'));
const markerPath = path.join(profile, 'renderer-origin-migration.json');
const errors = [];
const expectedErrors = [];
const results = {};

// Deterministic, incompressible-enough payloads spanning several copy chunks.
function payload(length, seed) {
  const bytes = Buffer.alloc(length);
  let state = seed;
  for (let index = 0; index < length; index += 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    bytes[index] = state >>> 24;
  }
  return bytes;
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const database = payload(3 * 1024 * 1024 + 517, 11);
const nested = payload(4096, 29);
const sentinel = `ñ ✓ "quoted"   ${'x'.repeat(200_000)}`;

// The current main process, with the window pointed at the built index.html on
// file:// the way builds before the app scheme loaded it.
await writeFile(
  path.join(legacyFixture, 'package.json'),
  JSON.stringify({ name: 'lingua', version: '0.0.0-legacy', main: 'main.cjs' })
);
await writeFile(
  path.join(legacyFixture, 'main.cjs'),
  `const { BrowserWindow } = require('electron');
BrowserWindow.prototype.loadURL = function () {
  return this.loadFile(${JSON.stringify(path.join(root, '.vite/renderer/main_window/index.html'))});
};
require(${JSON.stringify(path.join(root, '.vite/build/main.js'))});
`
);

async function launch(appPath) {
  const app = await _electron.launch({
    executablePath,
    args: [...isolatedCredentialStoreArgs(), appPath],
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      LINGUA_RENDERER_URL: undefined,
      LINGUA_SMOKE_USER_DATA_DIR: profile,
    },
    timeout: 30_000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(`${appPath}: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`${appPath}: ${message.text()}`);
  });
  await page.getByTestId('app-chrome').waitFor({ timeout: 60_000 });
  return { app, page };
}

const readOrigin = page =>
  page.evaluate(async () => {
    const storage = Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, index) => {
        const key = localStorage.key(index);
        return [key, localStorage.getItem(key)];
      })
    );
    const files = {};
    const pending = [{ dir: await navigator.storage.getDirectory(), prefix: '' }];
    while (pending.length) {
      const { dir, prefix } = pending.pop();
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') pending.push({ dir: handle, prefix: `${prefix}${name}/` });
        else {
          const digest = await crypto.subtle.digest('SHA-256', await (await handle.getFile()).arrayBuffer());
          files[prefix + name] = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
        }
      }
    }
    return { origin: location.origin, storage, files, lang: document.documentElement.lang };
  });

async function codeCacheEntries() {
  try {
    return (await readdir(path.join(profile, 'Code Cache', 'js'))).filter(name => name !== 'index').length;
  } catch {
    return 0;
  }
}

try {
  // 1. An older build writes its usual data plus Spanish and OPFS files.
  let { app, page } = await launch(legacyFixture);
  assert.equal(new URL(page.url()).protocol, 'file:');
  // Reload so the running app holds Spanish too and cannot persist English over it.
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{}}');
    settings.state.language = 'es';
    localStorage.setItem('lingua-settings', JSON.stringify(settings));
  });
  await page.reload();
  await page.getByTestId('app-chrome').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'es');
  await page.evaluate(
    async ({ sentinel, database, nested }) => {
      localStorage.setItem('lingua-origin-smoke', sentinel);
      const write = async (dir, name, base64) => {
        const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await writable.write(Uint8Array.from(atob(base64), char => char.charCodeAt(0)));
        await writable.close();
      };
      const opfs = await navigator.storage.getDirectory();
      await write(opfs, 'lingua-origin-smoke.db', database);
      const sub = await (await opfs.getDirectoryHandle('lingua-origin-smoke', { create: true }))
        .getDirectoryHandle('nested', { create: true });
      await write(sub, 'b.bin', nested);
    },
    { sentinel, database: database.toString('base64'), nested: nested.toString('base64') }
  );
  const legacy = await readOrigin(page);
  await app.close();
  // Builds before the app scheme never wrote the marker.
  await rm(markerPath, { force: true });
  results.legacyKeys = Object.keys(legacy.storage).length;

  // 2. The current build migrates on its first launch.
  ({ app, page } = await launch(root));
  assert.equal(new URL(page.url()).protocol, 'app:');
  const migrated = await readOrigin(page);
  assert.equal(migrated.origin, 'app://lingua');
  assert.equal(migrated.storage['lingua-origin-smoke'], sentinel);
  for (const key of Object.keys(legacy.storage)) {
    assert.ok(key in migrated.storage, `missing migrated key ${key}`);
  }
  assert.equal(migrated.lang, 'es', 'migrated settings drive the UI language');
  assert.equal(migrated.files['lingua-origin-smoke.db'], sha256(database));
  assert.equal(migrated.files['lingua-origin-smoke/nested/b.bin'], sha256(nested));
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  assert.equal(marker.state, 'done');
  assert.equal(marker.attempts, 1);
  // Closing the older build may store a few more keys after the snapshot.
  assert.ok(marker.localStorageKeys >= results.legacyKeys, JSON.stringify(marker));
  assert.equal(marker.fileBytes, database.length + nested.length);
  results.marker = marker;
  // The file:// origin let the renderer and its workers read any local file.
  const probe = "fetch('file:///etc/hosts').then(() => 'read', () => 'refused')";
  results.fileFetchFromRenderer = await page.evaluate(probe);
  // A worker has no page CSP, so check the scheme itself on a document without one.
  results.fileFetchWithoutCsp = await app.evaluate(async ({ BrowserWindow }, probe) => {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    try {
      await window.loadURL('app://lingua/favicon.svg');
      return await window.webContents.executeJavaScript(probe);
    } finally {
      window.destroy();
    }
  }, probe);
  assert.equal(results.fileFetchFromRenderer, 'refused');
  assert.equal(results.fileFetchWithoutCsp, 'refused');
  expectedErrors.push(/file:\/\/\/etc\/hosts/);
  await page.evaluate(() => localStorage.setItem('lingua-origin-smoke', 'changed on the app scheme'));
  await page.screenshot({ path: path.join(artifacts, 'migrated-es.png') });
  await app.close();

  // 3. Later launches neither migrate again nor roll data back; the V8 code cache fills.
  for (let launchIndex = 0; launchIndex < 2; launchIndex += 1) {
    ({ app, page } = await launch(root));
    const again = await readOrigin(page);
    assert.equal(again.storage['lingua-origin-smoke'], 'changed on the app scheme');
    await app.close();
  }
  assert.deepEqual(JSON.parse(await readFile(markerPath, 'utf8')), marker);
  results.codeCacheEntries = await codeCacheEntries();
  assert.ok(results.codeCacheEntries > 1, `code cache stayed empty: ${results.codeCacheEntries}`);

  // 4. The file:// copy is untouched, so an older build still opens with it.
  ({ app, page } = await launch(legacyFixture));
  const downgrade = await readOrigin(page);
  assert.equal(downgrade.storage['lingua-origin-smoke'], sentinel);
  assert.equal(downgrade.files['lingua-origin-smoke.db'], sha256(database));
  await app.close();

  assert.deepEqual(
    errors.filter(error => !expectedErrors.some(pattern => pattern.test(error))),
    []
  );
  console.log('Origin migration smoke passed:', JSON.stringify(results));
} finally {
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ results, errors }, null, 2));
  await rm(profile, { recursive: true, force: true });
  await rm(legacyFixture, { recursive: true, force: true });
}
