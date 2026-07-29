import { importChain, walkStaticImportGraph } from './staticImportGraph.mjs';

export const RUNNER_GRAPH_PACKAGES = ['acorn', 'js-yaml', 'magic-string'];

function finiteNumbers(values) {
  return values.filter(value => typeof value === 'number' && Number.isFinite(value));
}

export function percentile(values, fraction) {
  const sorted = finiteNumbers(values).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];

  const index = Math.min(1, Math.max(0, fraction)) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

/**
 * Median + interquartile range is robust enough for the intentionally small
 * local sample set and easier to interpret than standard deviation here.
 * Wall-clock summaries remain evidence only; CI never compares them to a hard
 * threshold.
 */
export function summarizeMetric(values) {
  const samples = finiteNumbers(values);
  const p25 = percentile(samples, 0.25);
  const p75 = percentile(samples, 0.75);
  return {
    samples: samples.length,
    median: percentile(samples, 0.5),
    p25,
    p75,
    iqr: p25 === null || p75 === null ? null : p75 - p25,
    min: samples.length === 0 ? null : Math.min(...samples),
    max: samples.length === 0 ? null : Math.max(...samples),
  };
}

function matchesPackage(specifier, packageName) {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

/**
 * Explain every eager path from App to packages implicated in execution and
 * dependency detection. Empty importer arrays are meaningful evidence: the
 * manual/auto execution boundary should leave js-yaml and magic-string lazy,
 * while acorn remains eager until dependency detection gets its own boundary.
 */
export function collectRunnerImportEvidence({
  repoRoot,
  entry = 'src/renderer/App.tsx',
  packages = RUNNER_GRAPH_PACKAGES,
}) {
  const graph = walkStaticImportGraph({ repoRoot, entry });
  const packageEvidence = {};

  for (const packageName of packages) {
    const importers = [];
    for (const [specifier, sourceFiles] of graph.bareImporters) {
      if (!matchesPackage(specifier, packageName)) continue;
      for (const sourceFile of sourceFiles) {
        importers.push({
          specifier,
          importer: sourceFile,
          chain: [...importChain(graph.parents, sourceFile), specifier],
        });
      }
    }
    packageEvidence[packageName] = importers.sort(
      (left, right) =>
        left.chain.length - right.chain.length || left.importer.localeCompare(right.importer)
    );
  }

  return {
    entry,
    reachableSourceModules: graph.parents.size,
    packages: packageEvidence,
  };
}

function summarizeMemorySnapshots(samples) {
  const firstRss = [];
  const lastRss = [];
  const rssDelta = [];
  const firstHeap = [];
  const lastHeap = [];
  const heapDelta = [];
  let supportedSnapshots = 0;
  let totalSnapshots = 0;

  for (const sample of samples) {
    const snapshots = Array.isArray(sample.memorySnapshots)
      ? sample.memorySnapshots.map(entry => entry?.snapshot).filter(Boolean)
      : [];
    totalSnapshots += snapshots.length;
    const supported = snapshots.filter(snapshot => snapshot.ok === true);
    supportedSnapshots += supported.length;
    const first = supported[0]?.process;
    const last = supported.at(-1)?.process;
    if (!first || !last) continue;
    if (Number.isFinite(first.rssBytes)) firstRss.push(first.rssBytes);
    if (Number.isFinite(last.rssBytes)) lastRss.push(last.rssBytes);
    if (Number.isFinite(first.heapUsedBytes)) firstHeap.push(first.heapUsedBytes);
    if (Number.isFinite(last.heapUsedBytes)) lastHeap.push(last.heapUsedBytes);
    if (Number.isFinite(first.rssBytes) && Number.isFinite(last.rssBytes)) {
      rssDelta.push(last.rssBytes - first.rssBytes);
    }
    if (Number.isFinite(first.heapUsedBytes) && Number.isFinite(last.heapUsedBytes)) {
      heapDelta.push(last.heapUsedBytes - first.heapUsedBytes);
    }
  }

  return {
    supportedSnapshots,
    totalSnapshots,
    firstRssBytes: summarizeMetric(firstRss),
    lastRssBytes: summarizeMetric(lastRss),
    rssDeltaBytes: summarizeMetric(rssDelta),
    firstHeapUsedBytes: summarizeMetric(firstHeap),
    lastHeapUsedBytes: summarizeMetric(lastHeap),
    heapUsedDeltaBytes: summarizeMetric(heapDelta),
  };
}

export function summarizeWebActivation(samples) {
  const languages = [...new Set(samples.map(sample => sample.language))].sort();
  return {
    coldLandingReadyMs: summarizeMetric(samples.map(sample => sample.landingReadyMs)),
    firstEditorInteractiveMs: summarizeMetric(
      samples.map(sample => sample.firstEditorInteractiveMs)
    ),
    bootTotalMs: summarizeMetric(samples.map(sample => sample.boot?.totalDurationMs)),
    firstRunByLanguage: Object.fromEntries(
      languages.map(language => [
        language,
        summarizeMetric(
          samples
            .filter(sample => sample.language === language)
            .map(sample => sample.firstRunWallTimeMs)
        ),
      ])
    ),
    heapBeforeRunBytes: summarizeMetric(samples.map(sample => sample.heapBeforeRunBytes)),
    heapAfterRunBytes: summarizeMetric(samples.map(sample => sample.heapAfterRunBytes)),
    heapDeltaBytes: summarizeMetric(samples.map(sample => sample.heapDeltaBytes)),
  };
}

export function summarizeDesktopActivation(samples) {
  const languages = [
    ...new Set(samples.flatMap(sample => Object.keys(sample.firstRunTimings ?? {}))),
  ].sort();

  return {
    launcherToSmokeReadyMs: summarizeMetric(samples.map(sample => sample.launcherToSmokeReadyMs)),
    firstEditorInteractiveMs: summarizeMetric(
      samples.map(sample => sample.firstEditorInteractionWallTimeMs)
    ),
    totalSmokeWallTimeMs: summarizeMetric(samples.map(sample => sample.totalSmokeWallTimeMs)),
    firstRunByLanguage: Object.fromEntries(
      languages.map(language => [
        language,
        {
          wallTimeMs: summarizeMetric(
            samples.map(sample => sample.firstRunTimings?.[language]?.executionWallTimeMs)
          ),
          runnerTimeMs: summarizeMetric(
            samples.map(sample => sample.firstRunTimings?.[language]?.runnerExecutionTimeMs)
          ),
        },
      ])
    ),
    memory: summarizeMemorySnapshots(samples),
  };
}
