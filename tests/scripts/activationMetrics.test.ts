import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectRunnerImportEvidence,
  percentile,
  summarizeDesktopActivation,
  summarizeMetric,
  summarizeWebActivation,
} from '../../scripts/lib/activationMetrics.mjs';
import { activationSurfaceIncludes, parseArgs } from '../../scripts/measure-activation.mjs';

const repoRoot = path.resolve(__dirname, '../..');

describe('activation performance metrics', () => {
  it('keeps desktop-only runs independent from web prerequisites', () => {
    const options = parseArgs(['--surface=desktop', '--samples=2', '--skip-build']);

    expect(options).toMatchObject({
      surface: 'desktop',
      samples: 2,
      skipBuild: true,
    });
    expect(activationSurfaceIncludes(options.surface, 'desktop')).toBe(true);
    expect(activationSurfaceIncludes(options.surface, 'web')).toBe(false);
  });

  it('reports interpolated percentiles and robust dispersion', () => {
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(25);
    expect(summarizeMetric([40, null, 10, Number.NaN, 30, 20])).toEqual({
      samples: 4,
      median: 25,
      p25: 17.5,
      p75: 32.5,
      iqr: 15,
      min: 10,
      max: 40,
    });
  });

  it('summarizes web timings per language without treating null as zero', () => {
    const summary = summarizeWebActivation([
      {
        language: 'javascript',
        landingReadyMs: 100,
        firstEditorInteractiveMs: 300,
        firstRunWallTimeMs: 20,
        boot: { totalDurationMs: 90 },
        heapBeforeRunBytes: 1_000,
        heapAfterRunBytes: 1_200,
        heapDeltaBytes: 200,
      },
      {
        language: 'typescript',
        landingReadyMs: 120,
        firstEditorInteractiveMs: 340,
        firstRunWallTimeMs: 80,
        boot: { totalDurationMs: 110 },
        heapBeforeRunBytes: null,
        heapAfterRunBytes: null,
        heapDeltaBytes: null,
      },
    ]);

    expect(summary.coldLandingReadyMs.median).toBe(110);
    expect(summary.firstRunByLanguage.javascript.median).toBe(20);
    expect(summary.firstRunByLanguage.typescript.median).toBe(80);
    expect(summary.heapDeltaBytes.samples).toBe(1);
  });

  it('summarizes desktop first runs and supported memory snapshots', () => {
    const summary = summarizeDesktopActivation([
      {
        launcherToSmokeReadyMs: 2_000,
        firstEditorInteractionWallTimeMs: 500,
        totalSmokeWallTimeMs: 4_000,
        firstRunTimings: {
          javascript: {
            executionWallTimeMs: 20,
            runnerExecutionTimeMs: 5,
          },
        },
        memorySnapshots: [
          {
            snapshot: {
              ok: true,
              process: { rssBytes: 1_000, heapUsedBytes: 400 },
            },
          },
          {
            snapshot: {
              ok: true,
              process: { rssBytes: 1_300, heapUsedBytes: 500 },
            },
          },
        ],
      },
    ]);

    expect(summary.firstRunByLanguage.javascript.wallTimeMs.median).toBe(20);
    expect(summary.memory.supportedSnapshots).toBe(2);
    expect(summary.memory.rssDeltaBytes.median).toBe(300);
    expect(summary.memory.heapUsedDeltaBytes.median).toBe(100);
  });

  it('keeps execution and dependency parser packages out of the eager App graph', () => {
    const evidence = collectRunnerImportEvidence({ repoRoot });

    expect(evidence.reachableSourceModules).toBeGreaterThan(100);
    expect(evidence.packages.acorn).toEqual([]);
    expect(evidence.packages['js-yaml']).toEqual([]);
    expect(evidence.packages['magic-string']).toEqual([]);
  });
});
