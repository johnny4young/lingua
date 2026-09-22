#!/usr/bin/env node

// Launch the actual packaged app through Chromium CDP, not Node inspector.
// Never alter its fuse wire or the user's profile. Fixtures execute only on an explicit run.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';
const root = process.cwd();
const appPath = process.argv[2] && path.resolve(process.argv[2]);
const jestEntry = process.argv[3] && path.resolve(process.argv[3]);
if (process.platform !== 'darwin' || !appPath?.endsWith('.app') || !jestEntry) {
  throw new Error(
    'Usage on macOS: node scripts/smoke-packaged-project-tests.mjs <lingua.app> <installed jest/bin/jest.js>'
  );
}
const vitestEntry = path.join(root, 'node_modules/vitest/vitest.mjs');
await Promise.all([access(jestEntry), access(vitestEntry)]);
const artifacts = path.join(root, 'output/playwright/packaged-project-tests');
await mkdir(artifacts, { recursive: true });
const fixture = await mkdtemp(path.join(root, '.tmp-packaged-project-tests-'));
const binary = path.join(appPath, 'Contents/MacOS/lingua');
const profile = await mkdtemp(path.join(artifacts, 'profile-'));
const errors = [];
let child, browser, watchdog;
try {
  const fuses = await getCurrentFuseWire(appPath);
  // Fuse wire states are ASCII 0/1, not booleans.
  assert.equal(fuses[FuseV1Options.RunAsNode], 48);
  assert.equal(fuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable], 48);
  assert.equal(fuses[FuseV1Options.EnableNodeCliInspectArguments], 48);
  assert.equal(fuses[FuseV1Options.OnlyLoadAppFromAsar], 49);
  await mkdir(path.join(fixture, 'node_modules/vitest'), { recursive: true });
  await mkdir(path.join(fixture, 'node_modules/jest/bin'), { recursive: true });
  await writeFile(
    path.join(fixture, 'node_modules/jest/bin/jest.js'),
    `require(${JSON.stringify(jestEntry)});`
  );
  await writeFile(
    path.join(fixture, 'node_modules/vitest/vitest.mjs'),
    `import ${JSON.stringify(pathToFileURL(vitestEntry).href)};`
  );
  await writeFile(
    path.join(fixture, 'package.json'),
    JSON.stringify({ private: true, devDependencies: { jest: '*', vitest: '*' } })
  );
  await writeFile(
    path.join(fixture, 'vitest.config.mjs'),
    'export default { test: { globals: true } };'
  );
  await writeFile(
    path.join(fixture, 'jest.config.cjs'),
    'module.exports = { testEnvironment: "node" };'
  );
  await writeFile(
    path.join(fixture, 'example.test.js'),
    'test("packaged project test", () => { expect(2 + 2).toBe(4); expect(process.versions.electron).toBeUndefined(); expect(process.env.ELECTRON_RUN_AS_NODE).toBeUndefined(); });'
  );
  await writeFile(
    path.join(profile, 'filesystem-approvals.json'),
    JSON.stringify({ version: 1, roots: [fixture], files: [] })
  );
  child = spawn(binary, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'], {
    env: { ...process.env, LINGUA_SMOKE_USER_DATA_DIR: profile, ELECTRON_RUN_AS_NODE: undefined },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.resume();
  // The fixtures are tiny. Bound a broken packaged IPC round trip as well as boot.
  watchdog = setTimeout(() => child.kill('SIGTERM'), 180_000);
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP startup deadline')), 30000);
    child.on('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`App exited ${code}`));
    });
    child.stderr.on('data', data => {
      const text = data.toString();
      process.stderr.write(text);
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent('page'));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.locator('[data-testid="app-chrome"]').waitFor({ timeout: 60000 });
  const approved = await page.evaluate(fixture => window.lingua.fs.reopenRoot(fixture), fixture);
  assert.equal(approved.ok, true);
  const detection = await page.evaluate(
    id => window.lingua.projectTests.detect(id),
    approved.rootId
  );
  assert.deepEqual(detection.candidates.map(c => c.framework), ['vitest', 'jest']);
  assert(detection.candidates.every(c => c.available));
  const results = [];
  for (const framework of ['vitest', 'jest']) {
    const result = await page.evaluate(
      ({ id, framework }) => window.lingua.projectTests.run(id, framework, `packaged-${framework}`),
      { id: approved.rootId, framework }
    );
    assert.equal(result.kind, 'success', JSON.stringify(result));
    assert.equal(result.exitCode, 0);
    results.push(result);
  }
  await writeFile(
    path.join(fixture, 'example.test.js'),
    'test("intentional failure", () => { expect(2 + 2).toBe(5); });'
  );
  const failed = await page.evaluate(
    id => window.lingua.projectTests.run(id, 'vitest', 'packaged-failure'),
    approved.rootId
  );
  assert.equal(failed.kind, 'failed');
  assert.equal(failed.exitCode, 1);
  results.push(failed);
  // Exercise actual process-tree cancellation, not an injected spawn.
  await writeFile(
    path.join(fixture, 'node_modules/vitest/vitest.mjs'),
    'console.log("waiting-for-stop:" + process.pid); setInterval(() => {}, 1000);'
  );
  await page.evaluate(id => {
    globalThis.__projectTestOutput = '';
    window.lingua.projectTests.onOutput(e => {
      globalThis.__projectTestOutput += e.chunk;
    });
    globalThis.__projectTestRun = window.lingua.projectTests.run(id, 'vitest', 'packaged-stop');
  }, approved.rootId);
  await page.waitForFunction(() => globalThis.__projectTestOutput.includes('waiting-for-stop:'));
  const pid = Number(
    (await page.evaluate(() => globalThis.__projectTestOutput)).match(/waiting-for-stop:(\d+)/)[1]
  );
  assert.equal(
    (
      await page.evaluate(
        id => window.lingua.projectTests.stop(id, 'packaged-stop'),
        approved.rootId
      )
    ).stopped,
    true
  );
  const stopped = await page.evaluate(() => globalThis.__projectTestRun);
  assert.equal(stopped.kind, 'stopped');
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(artifacts, 'project-tests-packaged.json'),
    JSON.stringify({ fuses, detection, results, stopped, childExited: true, errors }, null, 2)
  );
  console.log('PACKAGED_PROJECT_TESTS_OK');
} finally {
  clearTimeout(watchdog);
  await browser?.close();
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
  await Promise.all([
    rm(profile, { recursive: true, force: true }),
    rm(fixture, { recursive: true, force: true }),
  ]);
}
