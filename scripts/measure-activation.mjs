#!/usr/bin/env node
/* global Element, MutationObserver, document, requestAnimationFrame, window */

import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import {
  collectRunnerImportEvidence,
  summarizeDesktopActivation,
  summarizeWebActivation,
} from './lib/activationMetrics.mjs';
import { collectBuildTarget } from './performance-report.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

const DEFAULT_OUTPUT_DIR = path.join(repoRoot, 'output', 'performance');
const DEFAULT_DESKTOP_ARTIFACT = path.join(
  repoRoot,
  'output',
  'playwright',
  'desktop-smoke',
  'desktop-smoke-performance.json'
);
const WEB_LANGUAGES = {
  javascript: {
    source: 'console.log("activation-javascript");\n',
  },
  typescript: {
    source:
      'const activationLabel: string = "activation-typescript";\nconsole.log(activationLabel);\n',
  },
};

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

export function parseArgs(argv) {
  const options = {
    surface: 'all',
    samples: 3,
    skipBuild: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    port: 4176,
  };

  for (const arg of argv) {
    if (arg === '--skip-build') {
      options.skipBuild = true;
      continue;
    }
    if (arg.startsWith('--surface=')) {
      options.surface = arg.slice('--surface='.length);
      continue;
    }
    if (arg.startsWith('--samples=')) {
      options.samples = parsePositiveInteger(arg.slice('--samples='.length), '--samples');
      continue;
    }
    if (arg.startsWith('--output-dir=')) {
      options.outputDir = path.resolve(arg.slice('--output-dir='.length));
      continue;
    }
    if (arg.startsWith('--port=')) {
      options.port = parsePositiveInteger(arg.slice('--port='.length), '--port');
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!['web', 'desktop', 'all'].includes(options.surface)) {
    throw new Error('--surface must be web, desktop, or all.');
  }
  return options;
}

export function activationSurfaceIncludes(surface, target) {
  return surface === target || surface === 'all';
}

function commandResult(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(`${command} ${args.join(' ')} exited with ${code ?? signal ?? 'unknown status'}.`)
      );
    });
  });
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function buildWeb() {
  process.stdout.write('[activation] building production web bundle...\n');
  await commandResult(
    process.execPath,
    [
      path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build',
      '--config',
      'vite.web.config.mts',
    ],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    }
  );
}

async function waitForPreview(url, child, readLogs) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Vite preview exited before becoming ready.\n${readLogs()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Vite preview at ${url}.\n${readLogs()}`);
}

async function startPreview(port) {
  const host = '127.0.0.1';
  const url = `http://${host}:${port}`;
  const child = spawn(
    process.execPath,
    [
      path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
      'preview',
      '--config',
      'vite.web.config.mts',
      '--host',
      host,
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    }
  );
  let logs = '';
  const capture = chunk => {
    logs = `${logs}${chunk.toString()}`.slice(-20_000);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  try {
    await waitForPreview(url, child, () => logs);
  } catch (error) {
    await stopPreview(child);
    throw error;
  }
  return { child, url, readLogs: () => logs };
}

async function stopPreview(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
}

async function launchChromium() {
  try {
    return await chromium.launch({ channel: 'chromium', headless: true });
  } catch (channelError) {
    try {
      return await chromium.launch({ headless: true });
    } catch (bundledError) {
      try {
        // Some locked-down macOS runners cannot create Chromium's normal
        // rendezvous process tree. Keep the representative launch paths first,
        // then fall back to a single unsandboxed process for local evidence.
        return await chromium.launch({
          headless: true,
          args: ['--single-process', '--no-zygote', '--disable-gpu', '--no-sandbox'],
        });
      } catch (compatibilityError) {
        throw new Error(
          `Unable to launch Chromium for activation measurement. Channel error: ${
            channelError instanceof Error ? channelError.message : String(channelError)
          }. Bundled error: ${
            bundledError instanceof Error ? bundledError.message : String(bundledError)
          }. Compatibility fallback error: ${
            compatibilityError instanceof Error
              ? compatibilityError.message
              : String(compatibilityError)
          }.`,
          { cause: compatibilityError }
        );
      }
    }
  }
}

async function installActivationProbe(context) {
  await context.addInitScript(
    ({ appVersion }) => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem(
        'lingua-settings',
        JSON.stringify({
          state: {
            language: 'en',
            lastSeenVersion: appVersion,
            suppressTourAutoStart: true,
            hasCompletedOnboardingWelcome: false,
            hasCompletedOnboardingFirstRun: false,
            hasCompletedOnboardingFirstSnippet: false,
            onboardingWelcomeSeedVersion: 0,
            telemetryConsent: 'declined',
            workflowModeDefaultsByLanguage: {
              javascript: 'run',
              typescript: 'run',
            },
          },
          version: 0,
        })
      );

      const probe = {
        landingReadyAt: null,
        editorReadyAt: null,
        runClickedAt: null,
        runSawRunning: false,
        runCompletedAt: null,
      };
      window.__linguaActivationProbe = probe;

      let editorFrameScheduled = false;
      const checkDom = () => {
        if (
          probe.landingReadyAt === null &&
          document.querySelector('[data-testid="license-badge"]')
        ) {
          probe.landingReadyAt = performance.now();
        }

        if (
          probe.editorReadyAt === null &&
          !editorFrameScheduled &&
          document.querySelector('.monaco-editor .view-lines')
        ) {
          editorFrameScheduled = true;
          requestAnimationFrame(() => {
            editorFrameScheduled = false;
            const viewLines = document.querySelector('.monaco-editor .view-lines');
            if (viewLines && viewLines.getBoundingClientRect().height > 0) {
              probe.editorReadyAt = performance.now();
            }
          });
        }
      };

      document.addEventListener(
        'click',
        event => {
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest('[data-testid="action-pill-run"]')) {
            probe.runClickedAt = performance.now();
            probe.runSawRunning = false;
            probe.runCompletedAt = null;
          }
        },
        true
      );

      const observer = new MutationObserver(records => {
        for (const record of records) {
          if (
            record.type !== 'attributes' ||
            !(record.target instanceof Element) ||
            !record.target.matches('[data-testid="action-pill-run"]') ||
            record.attributeName !== 'data-running' ||
            probe.runClickedAt === null
          ) {
            continue;
          }
          if (record.oldValue === 'false') {
            probe.runSawRunning = true;
          } else if (record.oldValue === 'true' && probe.runSawRunning) {
            probe.runCompletedAt = performance.now();
          }
        }
        checkDom();
      });
      observer.observe(document, {
        attributes: true,
        attributeOldValue: true,
        childList: true,
        subtree: true,
        attributeFilter: ['data-running', 'data-execution-state'],
      });
      checkDom();
    },
    {
      appVersion: packageJson.version,
    }
  );
}

async function readBootSnapshot(page) {
  return page.evaluate(() => {
    const phases = ['system-language', 'i18n', 'react-mount', 'first-paint', 'rehydration'];
    const mark = name =>
      performance.getEntriesByName(`lingua:boot:${name}`, 'mark')[0]?.startTime ?? null;
    const start = mark('start');
    let previous = start;
    const timings = [];
    for (const phase of phases) {
      const end = mark(phase);
      if (end !== null && previous !== null) {
        timings.push({
          phase,
          durationMs: Math.round((end - previous) * 100) / 100,
        });
      }
      previous = end;
    }
    const end = mark('rehydration');
    return {
      version: 1,
      totalDurationMs:
        start === null || end === null ? null : Math.round((end - start) * 100) / 100,
      phases: timings,
    };
  });
}

async function readHeapUsed(page) {
  return page.evaluate(() => {
    const memory = performance.memory;
    return typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null;
  });
}

async function measureWebSample({ url, language, ordinal }) {
  const browser = await launchChromium();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    serviceWorkers: 'block',
  });
  await installActivationProbe(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => {
    consoleErrors.push(error.message);
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page
      .locator('[data-testid="license-badge"]')
      .waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(
      () =>
        window.__linguaActivationProbe?.landingReadyAt !== null &&
        performance.getEntriesByName('lingua:boot:rehydration', 'mark').length > 0,
      undefined,
      { timeout: 30_000 }
    );

    await page.locator('.monaco-editor .view-lines').waitFor({
      state: 'visible',
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => window.__linguaActivationProbe?.editorReadyAt !== null,
      undefined,
      { timeout: 30_000 }
    );

    if (language === 'typescript') {
      await page.locator('[data-testid="action-pill-lang"]').click();
      await page.getByRole('menuitem', { name: /^TypeScript\b/i }).click();
      await page
        .locator('[data-testid="editor-tab-activation"][aria-current="page"][aria-label^="TS "]')
        .waitFor({ state: 'visible', timeout: 10_000 });
    }

    const editor = page.locator('.monaco-editor').first();
    await editor.click({ position: { x: 140, y: 42 } });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(WEB_LANGUAGES[language].source);

    const runButton = page.locator('[data-testid="action-pill-run"]');
    await runButton.waitFor({ state: 'visible' });
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="action-pill-run"]')?.getAttribute('data-workflow') ===
        'run'
    );
    const heapBeforeRunBytes = await readHeapUsed(page);
    await runButton.click();
    await page.waitForFunction(
      () => {
        const probe = window.__linguaActivationProbe;
        const activeTab = document.querySelector(
          '[data-testid="editor-tab-activation"][aria-current="page"]'
        )?.parentElement;
        return (
          probe?.runCompletedAt !== null &&
          activeTab?.getAttribute('data-execution-state') === 'success'
        );
      },
      undefined,
      { timeout: 30_000 }
    );
    const heapAfterRunBytes = await readHeapUsed(page);

    const timing = await page.evaluate(() => {
      const probe = window.__linguaActivationProbe;
      const start = performance.getEntriesByName('lingua:boot:start', 'mark')[0]?.startTime ?? null;
      return {
        landingReadyMs:
          start === null || probe?.landingReadyAt === null ? null : probe.landingReadyAt - start,
        firstEditorInteractiveMs:
          start === null || probe?.editorReadyAt === null ? null : probe.editorReadyAt - start,
        firstRunWallTimeMs:
          probe?.runClickedAt === null || probe?.runCompletedAt === null
            ? null
            : probe.runCompletedAt - probe.runClickedAt,
      };
    });
    const boot = await readBootSnapshot(page);

    if (consoleErrors.length > 0) {
      throw new Error(
        `Web activation sample ${language} #${ordinal} emitted console errors:\n${consoleErrors.join('\n')}`
      );
    }

    return {
      sample: ordinal,
      language,
      ...timing,
      boot,
      heapBeforeRunBytes,
      heapAfterRunBytes,
      heapDeltaBytes:
        heapBeforeRunBytes === null || heapAfterRunBytes === null
          ? null
          : heapAfterRunBytes - heapBeforeRunBytes,
      consoleErrors,
    };
  } catch (error) {
    const bodyText = await page
      .locator('body')
      .innerText()
      .catch(() => '<body unavailable>');
    throw new Error(
      `Web activation sample ${language} #${ordinal} failed.\nConsole errors:\n${
        consoleErrors.join('\n') || '<none>'
      }\nVisible body:\n${bodyText.slice(0, 4_000)}`,
      { cause: error }
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

async function collectWebSamples({ url, samples }) {
  const results = [];
  for (let ordinal = 1; ordinal <= samples; ordinal += 1) {
    for (const language of Object.keys(WEB_LANGUAGES)) {
      process.stdout.write(`[activation] web ${language} sample ${ordinal}/${samples}...\n`);
      results.push(await measureWebSample({ url, language, ordinal }));
    }
  }
  return results;
}

async function collectDesktopSamples(samples) {
  const results = [];
  for (let ordinal = 1; ordinal <= samples; ordinal += 1) {
    process.stdout.write(`[activation] desktop smoke sample ${ordinal}/${samples}...\n`);
    await unlink(DEFAULT_DESKTOP_ARTIFACT).catch(error => {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    });
    await commandResult(
      process.execPath,
      [path.join(repoRoot, 'scripts', 'run-desktop-smoke.mjs')],
      {
        cwd: repoRoot,
        stdio: 'inherit',
        env: process.env,
      }
    );
    const payload = JSON.parse(await readFile(DEFAULT_DESKTOP_ARTIFACT, 'utf8'));
    results.push({ sample: ordinal, ...payload });
  }
  return results;
}

function currentRevision() {
  try {
    return {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }).trim(),
      dirty:
        execFileSync('git', ['status', '--porcelain'], {
          cwd: repoRoot,
          encoding: 'utf8',
        }).trim().length > 0,
    };
  } catch {
    return { commit: null, dirty: null };
  }
}

function normalizeBuildTarget(target) {
  if (!target.available) {
    return {
      id: target.id,
      label: target.label,
      available: false,
      reason: target.reason,
    };
  }
  return {
    id: target.id,
    label: target.label,
    available: true,
    categories: target.categories,
    initialAssets: target.initialAssets,
    largestAssets: target.assets.slice(0, 10),
  };
}

async function collectBuildOutputs({ requireWeb }) {
  const targets = [
    {
      id: 'web',
      label: 'Web build',
      root: path.join(repoRoot, 'dist', 'web'),
      required: requireWeb,
    },
    {
      id: 'renderer',
      label: 'Desktop renderer build',
      root: path.join(repoRoot, '.vite', 'renderer', 'main_window'),
      required: false,
    },
  ];
  const results = [];
  for (const target of targets) {
    results.push(normalizeBuildTarget(await collectBuildTarget(target)));
  }
  return results;
}

function formatMs(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${Math.round(value)} ms`;
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return 'n/a';
  if (Math.abs(value) >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(2)} MiB`;
  }
  if (Math.abs(value) >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${Math.round(value)} B`;
}

function metricText(metric, formatter = formatMs) {
  if (!metric || metric.median === null) return 'n/a';
  return `${formatter(metric.median)} median; IQR ${formatter(metric.iqr)}; range ${formatter(metric.min)}-${formatter(metric.max)}; n=${metric.samples}`;
}

function renderMarkdown(report) {
  const lines = [
    '# Lingua Activation Performance',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Revision: ${report.revision.commit ?? 'unknown'}${report.revision.dirty ? ' (dirty worktree)' : ''}`,
    '',
    'Wall-clock values are diagnostic evidence, not CI pass/fail thresholds.',
    '',
    '## Build sizes',
    '',
  ];

  for (const target of report.builds) {
    lines.push(`### ${target.label}`);
    lines.push('');
    if (!target.available) {
      lines.push(`Unavailable: ${target.reason}.`, '');
      continue;
    }
    lines.push('| Category | Files | Raw | Gzip |');
    lines.push('|---|---:|---:|---:|');
    for (const [category, total] of Object.entries(target.categories)) {
      lines.push(
        `| ${category} | ${total.files} | ${formatBytes(total.bytes)} | ${formatBytes(total.gzipBytes)} |`
      );
    }
    lines.push('');
  }

  lines.push('## Web activation');
  lines.push('');
  if (!report.web) {
    lines.push('Not collected.', '');
  } else {
    lines.push('| Metric | Median and dispersion |');
    lines.push('|---|---|');
    lines.push(`| Cold landing ready | ${metricText(report.web.summary.coldLandingReadyMs)} |`);
    lines.push(
      `| First editor interactive | ${metricText(report.web.summary.firstEditorInteractiveMs)} |`
    );
    lines.push(`| Boot total | ${metricText(report.web.summary.bootTotalMs)} |`);
    for (const [language, metric] of Object.entries(report.web.summary.firstRunByLanguage)) {
      lines.push(`| First Run - ${language} | ${metricText(metric)} |`);
    }
    lines.push(
      `| Heap delta | ${metricText(report.web.summary.heapDeltaBytes, formatBytes)} |`,
      ''
    );
  }

  lines.push('## Desktop activation');
  lines.push('');
  if (!report.desktop) {
    lines.push('Not collected.', '');
  } else {
    lines.push('| Metric | Median and dispersion |');
    lines.push('|---|---|');
    lines.push(
      `| Launcher to smoke ready | ${metricText(report.desktop.summary.launcherToSmokeReadyMs)} |`
    );
    lines.push(
      `| First editor interactive | ${metricText(report.desktop.summary.firstEditorInteractiveMs)} |`
    );
    for (const [language, metric] of Object.entries(report.desktop.summary.firstRunByLanguage)) {
      lines.push(
        `| First Run - ${language} | ${metricText(metric.wallTimeMs)} wall; ${metricText(metric.runnerTimeMs)} runner |`
      );
    }
    lines.push(
      `| RSS delta | ${metricText(report.desktop.summary.memory.rssDeltaBytes, formatBytes)} |`,
      ''
    );
  }

  lines.push('## Eager runner dependency evidence', '');
  for (const [packageName, importers] of Object.entries(report.staticRunnerImports.packages)) {
    lines.push(`### ${packageName}`, '');
    if (importers.length === 0) {
      lines.push('Not reachable from App.', '');
      continue;
    }
    for (const evidence of importers) {
      lines.push(`- ${evidence.chain.join(' -> ')}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function writeArtifacts(report, outputDir) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, 'activation-performance.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  );
  await writeFile(
    path.join(outputDir, 'activation-performance.md'),
    renderMarkdown(report),
    'utf8'
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const needsWeb = activationSurfaceIncludes(options.surface, 'web');
  const needsDesktop = activationSurfaceIncludes(options.surface, 'desktop');

  if (needsWeb && !options.skipBuild) {
    await buildWeb();
  } else if (needsWeb && !(await pathExists(path.join(repoRoot, 'dist', 'web', 'index.html')))) {
    throw new Error('dist/web/index.html is missing. Drop --skip-build or run pnpm run build:web.');
  }

  let preview = null;
  let webSamples = null;
  try {
    if (needsWeb) {
      preview = await startPreview(options.port);
      webSamples = await collectWebSamples({
        url: preview.url,
        samples: options.samples,
      });
    }
  } finally {
    if (preview) await stopPreview(preview.child);
  }

  const desktopSamples = needsDesktop ? await collectDesktopSamples(options.samples) : null;
  const builds = await collectBuildOutputs({ requireWeb: needsWeb });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    definitions: {
      cold: 'Fresh Chromium process/context with the first-install welcome scratchpad, or fresh Electron smoke user-data directory; local preview, OS file cache, and toolchains may be warm.',
      dispersion: 'Interquartile range with min/max range.',
      budgetPolicy:
        'Bundle byte ceilings remain blocking; wall-clock activation samples are diagnostic and never fail CI.',
    },
    revision: currentRevision(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpu: os.cpus()[0]?.model ?? null,
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    requestedSamplesPerCase: options.samples,
    builds,
    staticRunnerImports: collectRunnerImportEvidence({ repoRoot }),
    web:
      webSamples === null
        ? null
        : {
            samples: webSamples,
            summary: summarizeWebActivation(webSamples),
          },
    desktop:
      desktopSamples === null
        ? null
        : {
            samples: desktopSamples,
            summary: summarizeDesktopActivation(desktopSamples),
          },
  };
  await writeArtifacts(report, options.outputDir);
  process.stdout.write(renderMarkdown(report));
  process.stdout.write(
    `[activation] artifacts: ${path.join(options.outputDir, 'activation-performance.{json,md}')}\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch(error => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
}
