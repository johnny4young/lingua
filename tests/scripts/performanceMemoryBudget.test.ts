import { describe, expect, it } from 'vitest';
import {
  compareWithMemoryBudget,
  createBaseline,
  summarizeSmokeFootprint,
} from '../../scripts/performance-report.mjs';

const MB = 1024 * 1024;

function snapshot(label: string, footprints: Record<string, number | null>) {
  return {
    label,
    snapshot: {
      ok: true,
      process: { rssBytes: 1, heapUsedBytes: 1 },
      chromium: Object.entries(footprints).map(([type, mb], index) => ({
        type,
        pid: index + 1,
        workingSetSizeBytes: 1,
        peakWorkingSetSizeBytes: 1,
        privateBytes: 0,
        footprintBytes: mb === null ? null : mb * MB,
      })),
    },
  };
}

function runtime(snapshots: unknown[], packaged = true) {
  return {
    available: true,
    packaged,
    memory: { footprint: summarizeSmokeFootprint(snapshots) },
  };
}

const baseline = {
  schemaVersion: 1,
  budgets: {},
  memoryBudgets: { desktopSmoke: { peakFootprintWithoutGpu: { baselineBytes: 400 * MB, maxBytes: 460 * MB } } },
};

describe('desktop memory budget', () => {
  it('leaves the GPU process out and reports where the rest peaked', () => {
    const footprint = summarizeSmokeFootprint([
      snapshot('before-cases', { Browser: 70, Tab: 200, GPU: 600, Utility: 10 }),
      snapshot('after-python', { Browser: 72, Tab: 330, GPU: 110, Utility: 12 }),
    ]);
    expect(footprint).toMatchObject({
      available: true,
      peakWithoutGpuBytes: 414 * MB,
      peakLabel: 'after-python',
    });
    expect(footprint.samples[0]).toMatchObject({ totalBytes: 880 * MB, withoutGpuBytes: 280 * MB });
  });

  it('skips a snapshot that could not measure every process', () => {
    const footprint = summarizeSmokeFootprint([
      snapshot('before-cases', { Browser: 70, Tab: null }),
      { label: 'after-javascript', snapshot: { ok: false, reason: 'unsupported' } },
    ]);
    expect(footprint).toMatchObject({ available: false, peakWithoutGpuBytes: null });
  });

  it('fails a 100 MB regression that working set and main-process RSS never showed', () => {
    const regressed = runtime([snapshot('after-javascript', { Browser: 72, Tab: 430, GPU: 110 })]);
    const [violation] = compareWithMemoryBudget(regressed, baseline);
    expect(violation?.message).toContain('peakFootprintWithoutGpu');
    expect(violation?.message).toContain('after-javascript');
    expect(compareWithMemoryBudget(runtime([snapshot('after-javascript', { Browser: 72, Tab: 330 })]), baseline)).toEqual([]);
  });

  it('fails closed without a packaged footprint measurement or a budget', () => {
    const measured = runtime([snapshot('after-python', { Browser: 72, Tab: 330 })]);
    expect(compareWithMemoryBudget({ available: false, reason: 'missing-desktop-smoke-performance' }, baseline)).toHaveLength(1);
    expect(compareWithMemoryBudget(runtime([snapshot('after-python', { Browser: 72, Tab: 330 })], false), baseline)).toHaveLength(1);
    expect(compareWithMemoryBudget(runtime([snapshot('after-python', { Browser: null })]), baseline)).toHaveLength(1);
    expect(compareWithMemoryBudget(measured, { ...baseline, memoryBudgets: undefined })[0]?.message).toContain(
      'performance:baseline --memory'
    );
  });

  it('writes the memory budget with headroom and keeps it through bundle refreshes', () => {
    const report = {
      generatedAt: '2026-11-05T00:00:00.000Z',
      targets: [],
      runtimeObservability: runtime([snapshot('after-python', { Browser: 72, Tab: 328 })]),
    };
    const withMemory = createBaseline(report, { schemaVersion: 1, budgets: { web: {} } }, { memory: true });
    expect(withMemory.memoryBudgets.desktopSmoke.peakFootprintWithoutGpu).toEqual({
      baselineBytes: 400 * MB,
      maxBytes: Math.ceil(400 * MB * 1.15),
    });
    expect(withMemory.budgets).toEqual({ web: {} });
    expect(createBaseline({ ...report, runtimeObservability: { available: false } }, withMemory).memoryBudgets).toEqual(
      withMemory.memoryBudgets
    );
  });
});
