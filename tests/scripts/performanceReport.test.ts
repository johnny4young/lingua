import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertAllTargetsAvailable,
  buildPerformanceReport,
  classifyAsset,
  collectBuildTarget,
  collectDesktopSmokePerformance,
  compareWithBudgets,
  createBaseline,
  findBudgetSlack,
  parseInitialAssetReferences,
  renderConsoleTable,
  renderMarkdownReport,
  selectTargets,
  validateBaseline,
} from '../../scripts/performance-report.mjs';

async function createFixtureBuild() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-perf-'));
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await writeFile(
    path.join(root, 'index.html'),
    [
      '<script type="module" src="/assets/index.js"></script>',
      '<link rel="modulepreload" href="/assets/react.js">',
      '<link rel="stylesheet" href="/assets/index.css">',
    ].join('\n'),
    'utf8'
  );
  await writeFile(path.join(root, 'assets', 'index.js'), 'console.log("boot");', 'utf8');
  await writeFile(path.join(root, 'assets', 'react.js'), 'export const r = 1;', 'utf8');
  await writeFile(path.join(root, 'assets', 'index.css'), 'body{color:white}', 'utf8');
  await writeFile(path.join(root, 'assets', 'js-worker.js'), 'self.onmessage=()=>{};', 'utf8');
  await writeFile(path.join(root, 'assets', 'marked.esm.js'), 'export const marked = true;', 'utf8');
  await writeFile(path.join(root, 'assets', 'feature.js'), 'export const feature = true;', 'utf8');
  await writeFile(path.join(root, 'assets', 'runtime.wasm'), 'wasm', 'utf8');
  return root;
}

async function writeDesktopSmokePerformanceFixture(root: string) {
  const artifactPath = path.join(root, 'desktop-smoke-performance.json');
  await writeFile(
    artifactPath,
    JSON.stringify(
      {
        generatedAt: '2026-05-07T00:00:00.000Z',
        artifactDir: root,
        launcherToSmokeReadyMs: 1500,
        firstEditorInteractionWallTimeMs: 240,
        totalSmokeWallTimeMs: 12_000,
        firstRunTimings: {
          javascript: {
            runnerExecutionTimeMs: 12,
            executionWallTimeMs: 35,
          },
          typescript: {
            runnerExecutionTimeMs: 40,
            executionWallTimeMs: 90,
          },
          python: {
            runnerExecutionTimeMs: null,
            executionWallTimeMs: 6200,
          },
        },
        memorySnapshots: [
          {
            label: 'before-cases',
            snapshot: {
              ok: true,
              process: {
                rssBytes: 1000,
                heapUsedBytes: 200,
              },
            },
          },
          {
            label: 'after-python',
            snapshot: {
              ok: true,
              process: {
                rssBytes: 1750,
                heapUsedBytes: 260,
              },
            },
          },
          {
            label: 'after-rust',
            snapshot: {
              ok: false,
              reason: 'unsupported',
            },
          },
        ],
      },
      null,
      2
    ),
    'utf8'
  );
  return artifactPath;
}

describe('performance-report', () => {
  it('extracts initial JS and CSS references from Vite HTML', () => {
    const initial = parseInitialAssetReferences(
      '<script src="/assets/index.js"></script><link rel="stylesheet" href="./assets/app.css">'
    );

    expect([...initial]).toEqual(['assets/index.js', 'assets/app.css']);
  });

  it('classifies initial, worker, runtime, utility, lazy, and other assets', () => {
    const initial = new Set(['assets/index.js']);

    expect(classifyAsset('assets/index.js', initial)).toBe('initial');
    expect(classifyAsset('assets/js-worker.js', initial)).toBe('worker');
    expect(classifyAsset('pyodide/pyodide.asm.wasm', initial)).toBe('runtime');
    expect(classifyAsset('assets/marked.esm.js', initial)).toBe('utility');
    expect(classifyAsset('assets/feature.js', initial)).toBe('lazy');
    expect(classifyAsset('manifest.json', initial)).toBe('other');
  });

  it('collects category totals with gzip sizes', async () => {
    const root = await createFixtureBuild();
    try {
      const target = await collectBuildTarget({
        id: 'fixture',
        label: 'Fixture',
        root,
        required: true,
      });

      expect(target.available).toBe(true);
      expect(target.categories.initial.files).toBe(3);
      expect(target.categories.worker.files).toBe(1);
      expect(target.categories.runtime.files).toBe(1);
      expect(target.categories.utility.files).toBe(1);
      expect(target.categories.lazy.files).toBe(1);
      expect(target.categories.initial.gzipBytes).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('throws a clear error when a required build output is missing', async () => {
    await expect(
      collectBuildTarget({
        id: 'missing',
        label: 'Missing build',
        root: path.join(os.tmpdir(), 'does-not-exist-lingua-perf'),
        required: true,
      })
    ).rejects.toThrow(/Run the matching build/u);
  });

  it('reports budget violations against the baseline', async () => {
    const measurements = {
      targets: [
        {
          id: 'web',
          available: true,
          categories: {
            initial: { files: 1, bytes: 120, gzipBytes: 60 },
          },
        },
      ],
    };
    const baseline = {
      budgets: {
        web: {
          initial: { maxBytes: 100, maxGzipBytes: 70 },
        },
      },
    };

    expect(compareWithBudgets(measurements, baseline)).toEqual([
      expect.objectContaining({
        target: 'web',
        category: 'initial',
        metric: 'bytes',
      }),
    ]);
  });

  it('rejects malformed baselines before comparison', () => {
    expect(() => validateBaseline({ schemaVersion: 2, budgets: {} })).toThrow(/schemaVersion/u);
    expect(() => validateBaseline({ schemaVersion: 1 })).toThrow(/budgets/u);
  });

  it('builds and renders a report for available and optional missing targets', async () => {
    const root = await createFixtureBuild();
    try {
      const report = await buildPerformanceReport({
        baselinePath: path.join(root, 'missing-baseline.json'),
        targets: [
          { id: 'web', label: 'Web', root, required: true },
          { id: 'renderer', label: 'Renderer', root: path.join(root, 'missing'), required: false },
        ],
        desktopSmokePerformancePath: path.join(root, 'missing-desktop-smoke.json'),
      });

      expect(report.targets).toHaveLength(2);
      expect(report.measurements).toBe(report.targets);
      expect(report.budgets.web.initial.maxBytes).toBeGreaterThanOrEqual(
        report.targets[0].categories.initial.bytes
      );
      expect(renderMarkdownReport(report)).toContain('Lingua Performance Report');
      expect(renderMarkdownReport(report)).toContain('Unavailable: missing-build-output.');
      expect(report.runtimeObservability).toMatchObject({
        available: false,
        reason: 'missing-desktop-smoke-performance',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('adds desktop smoke runtime metrics to the performance report', async () => {
    const root = await createFixtureBuild();
    try {
      const desktopSmokePerformancePath = await writeDesktopSmokePerformanceFixture(root);
      const report = await buildPerformanceReport({
        baselinePath: path.join(root, 'missing-baseline.json'),
        targets: [{ id: 'web', label: 'Web', root, required: true }],
        desktopSmokePerformancePath,
      });

      expect(report.runtimeObservability).toMatchObject({
        available: true,
        launcherToSmokeReadyMs: 1500,
        firstEditorInteractionWallTimeMs: 240,
        totalSmokeWallTimeMs: 12_000,
        firstRunTimings: {
          javascript: {
            runnerExecutionTimeMs: 12,
            executionWallTimeMs: 35,
          },
        },
        memory: {
          totalSnapshots: 3,
          supportedSnapshots: 2,
          unsupportedSnapshots: 1,
          rssDeltaBytes: 750,
          heapUsedDeltaBytes: 60,
        },
      });
      expect(renderMarkdownReport(report)).toContain('Runtime Observability');
      expect(renderMarkdownReport(report)).toContain('Launch to smoke-ready');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('summarizes missing desktop smoke metrics as an unavailable optional source', async () => {
    const missingPath = path.join(os.tmpdir(), 'missing-desktop-smoke-performance.json');

    await expect(collectDesktopSmokePerformance(missingPath)).resolves.toMatchObject({
      available: false,
      reason: 'missing-desktop-smoke-performance',
    });
  });

  it('flags a same-origin runtime build once instead of reporting its byte overages', async () => {
    const root = await createFixtureBuild();
    try {
      await writeFile(path.join(root, 'assets', 'duckdb-mvp-abc123.wasm'), 'wasm', 'utf8');
      await mkdir(path.join(root, 'ruby'), { recursive: true });
      await writeFile(path.join(root, 'ruby', 'ruby+stdlib.wasm'), 'wasm', 'utf8');

      const web = await collectBuildTarget({
        id: 'web',
        label: 'Web',
        root,
        required: true,
        rejectSameOriginRuntime: true,
      });
      expect(web.sameOriginRuntimeAssets).toEqual([
        'assets/duckdb-mvp-abc123.wasm',
        'ruby/ruby+stdlib.wasm',
      ]);

      const baseline = {
        budgets: {
          web: {
            initial: { maxBytes: 1, maxGzipBytes: 1 },
            runtime: { maxBytes: 1, maxGzipBytes: 1 },
          },
        },
      };
      const violations = compareWithBudgets({ targets: [web] }, baseline);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ target: 'web', category: 'shape' });
      expect(violations[0].message).toMatch(/rebuild without LINGUA_WEB_RUNTIME_SAME_ORIGIN/u);

      // The desktop renderer ships every runtime same-origin by design, so
      // the same files are not a shape violation there.
      const renderer = await collectBuildTarget({
        id: 'renderer',
        label: 'Renderer',
        root,
        required: false,
        rejectSameOriginRuntime: false,
      });
      expect(
        compareWithBudgets({ targets: [renderer] }, { budgets: { renderer: {} } })
      ).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('warns when a tracked category measures far below its baseline', () => {
    const measurements = {
      targets: [
        {
          id: 'web',
          available: true,
          categories: {
            initial: { files: 1, bytes: 100, gzipBytes: 90 },
            lazy: { files: 1, bytes: 1000, gzipBytes: 900 },
          },
        },
      ],
    };
    const baseline = {
      budgets: {
        web: {
          initial: { baselineBytes: 200, baselineGzipBytes: 100, maxBytes: 220, maxGzipBytes: 110 },
          lazy: { baselineBytes: 1000, baselineGzipBytes: 1000, maxBytes: 1150, maxGzipBytes: 1150 },
        },
      },
    };

    const warnings = findBudgetSlack(measurements, baseline);
    expect(warnings.map((warning) => `${warning.category}.${warning.metric}`)).toEqual([
      'initial.bytes',
    ]);
    expect(warnings[0].message).toMatch(/performance:baseline --target=web/u);
    expect(compareWithBudgets(measurements, baseline)).toEqual([]);

    const report = {
      generatedAt: 'now',
      targets: [],
      violations: [],
      warnings,
      runtimeObservability: { available: false, reason: 'missing' },
    };
    expect(renderConsoleTable(report)).toContain('Budget warnings:');
    expect(renderMarkdownReport(report)).toContain('## Budget Warnings');
  });

  it('refreshes measured targets and keeps the budgets of targets without a build', () => {
    const report = {
      generatedAt: '2026-09-04T00:00:00.000Z',
      targets: [
        {
          id: 'web',
          available: true,
          categories: {
            initial: { files: 2, bytes: 1000, gzipBytes: 300 },
            runtime: { files: 0, bytes: 0, gzipBytes: 0 },
            worker: { files: 0, bytes: 0, gzipBytes: 0 },
            utility: { files: 0, bytes: 0, gzipBytes: 0 },
            lazy: { files: 0, bytes: 0, gzipBytes: 0 },
            other: { files: 0, bytes: 0, gzipBytes: 0 },
          },
        },
        { id: 'renderer', available: false },
      ],
    };
    const existing = {
      schemaVersion: 1,
      generatedAt: '2026-07-29T00:00:00.000Z',
      budgets: {
        web: { initial: { baselineBytes: 2000, maxBytes: 2200 } },
        renderer: { initial: { baselineBytes: 5000, maxBytes: 5500 } },
      },
    };

    const baseline = createBaseline(report, existing);
    expect(baseline.budgets.web.initial).toMatchObject({ baselineBytes: 1000, maxBytes: 1100 });
    expect(baseline.budgets.renderer).toEqual(existing.budgets.renderer);
    expect(baseline.lastRefresh).toEqual({
      renderer: '2026-07-29T00:00:00.000Z',
      web: '2026-09-04T00:00:00.000Z',
    });
    expect(() => validateBaseline(baseline)).not.toThrow();
  });

  it('refuses to write a baseline from a same-origin runtime build', () => {
    const report = {
      generatedAt: 'now',
      targets: [
        {
          id: 'web',
          available: true,
          rejectSameOriginRuntime: true,
          sameOriginRuntimeAssets: ['assets/duckdb-mvp-abc.wasm'],
          categories: {},
        },
      ],
    };
    expect(() => createBaseline(report, null)).toThrow(/LINGUA_WEB_RUNTIME_SAME_ORIGIN/u);
  });

  it('selects targets by id and rejects unknown ids', () => {
    const targets = [{ id: 'web' }, { id: 'renderer' }];
    expect(selectTargets(targets, [])).toBe(targets);
    expect(selectTargets(targets, ['web']).map((target) => target.id)).toEqual(['web']);
    expect(() => selectTargets(targets, ['wbe'])).toThrow(/Unknown performance target/u);
    expect(() =>
      selectTargets(targets, ['web'], { requireAllTargets: true })
    ).toThrow(/cannot be combined/u);
  });

  it('blocks baseline refreshes when a required target artifact is unavailable', () => {
    expect(() =>
      assertAllTargetsAvailable({
        targets: [
          { id: 'web', available: true },
          { id: 'renderer', available: false },
        ],
      })
    ).toThrow(/renderer/u);
  });
});
