#!/usr/bin/env node
// Ordinary app smoke: real bundled Electron/main/preload and native Node IPC.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron } from 'playwright';
import { assertUnicodeCapture, unicodeFixture } from './lib/nativeOutputSmoke.mjs';

const root = process.cwd();
const artifacts = path.join(root, 'output/playwright/native-output');
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(path.join(artifacts, 'profile-'));
const errors = [];
const results = [];
let app;
try {
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      LINGUA_SMOKE_USER_DATA_DIR: profile,
      LINGUA_RENDERER_URL: undefined,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30_000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.locator('[data-testid="app-chrome"]').waitFor({ timeout: 60_000 });
  assert.equal(new URL(page.url()).protocol, 'file:', 'Smoke uses the built desktop renderer');

  const captured = await page.evaluate(source => window.lingua.node.run(source, {
    runId: 'unicode-capture', timeoutMs: 15_000,
    messages: { stdoutTruncated: '[stdout truncated]', stderrTruncated: '[stderr truncated]' },
  }), unicodeFixture(false));
  assert.equal(captured.kind, 'success');
  assertUnicodeCapture(captured);
  results.push({ scenario: 'unicode-both-pipes', kind: captured.kind,
    stdoutBytes: Buffer.byteLength(captured.stdout), stderrBytes: Buffer.byteLength(captured.stderr) });

  // A readiness message on the independent stderr pipe proves that the child
  // remains alive after stdout crosses its capture cap. Stop uses normal IPC.
  await page.evaluate(source => {
    globalThis.__outputSmokeReady = false;
    globalThis.__outputSmokeUnsubscribe = window.lingua.node.onOutput(event => {
      if (event.runId === 'unicode-stop' && event.stream === 'stderr' && event.chunk.includes('READY')) {
        globalThis.__outputSmokeReady = true;
      }
    });
    globalThis.__outputSmokePending = window.lingua.node.run(source, {
      runId: 'unicode-stop', interactive: true, timeoutMs: 15_000,
      messages: { stdoutTruncated: '[stdout truncated]', stderrTruncated: '[stderr truncated]' },
    });
  }, unicodeFixture(true));
  await page.waitForFunction(() => globalThis.__outputSmokeReady, null, { timeout: 10_000 });
  const stopped = await page.evaluate(async () => {
    const response = await window.lingua.node.stop('unicode-stop');
    const result = await globalThis.__outputSmokePending;
    globalThis.__outputSmokeUnsubscribe();
    return { response, result };
  });
  assert.equal(stopped.response.stopped, true);
  assert.equal(stopped.result.kind, 'stopped');
  assertUnicodeCapture(stopped.result, ['stdout']);
  assert.equal(stopped.result.stderr, 'READY\n');
  results.push({ scenario: 'stop-after-stdout-cap', kind: stopped.result.kind });

  const recovered = await page.evaluate(() => window.lingua.node.run(
    'process.stdout.write("Recovered é漢😀");', { runId: 'unicode-recovery', timeoutMs: 10_000 }
  ));
  assert.equal(recovered.kind, 'success');
  assert.equal(recovered.stdout, 'Recovered é漢😀');
  assert.equal(recovered.stderr, '');
  results.push({ scenario: 'same-app-recovery', kind: recovered.kind });
  await page.screenshot({ path: path.join(artifacts, 'app.png') });
  assert.deepEqual(errors, [], 'Renderer console and uncaught errors');
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({
    results, errors, packaged: false,
    coverage: 'Built desktop app launch, renderer-to-main Node IPC, Unicode capture, Stop and recovery',
  }, null, 2));
  console.log('Native output smoke passed: Unicode on both pipes, Stop after cap, same-app recovery, zero renderer errors');
} finally {
  // App shutdown owns its native children. No process-table scanning or broad kill.
  await app?.close();
  await rm(profile, { recursive: true, force: true });
}
