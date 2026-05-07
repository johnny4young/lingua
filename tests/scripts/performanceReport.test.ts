import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertAllTargetsAvailable,
  buildPerformanceReport,
  classifyAsset,
  collectBuildTarget,
  compareWithBudgets,
  parseInitialAssetReferences,
  renderMarkdownReport,
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
      });

      expect(report.targets).toHaveLength(2);
      expect(report.measurements).toBe(report.targets);
      expect(report.budgets.web.initial.maxBytes).toBeGreaterThanOrEqual(
        report.targets[0].categories.initial.bytes
      );
      expect(renderMarkdownReport(report)).toContain('Lingua Performance Report');
      expect(renderMarkdownReport(report)).toContain('Unavailable: missing-build-output.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
