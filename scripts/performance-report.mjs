#!/usr/bin/env node

import { gzipSync } from 'node:zlib';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const DEFAULT_BASELINE_PATH = path.join(repoRoot, 'docs', 'performance', 'baseline.json');
const DEFAULT_OUTPUT_DIR = path.join(repoRoot, 'output', 'performance');

const DEFAULT_TARGETS = [
  {
    id: 'web',
    label: 'Web build',
    root: path.join(repoRoot, 'dist', 'web'),
    required: true,
  },
  {
    id: 'renderer',
    label: 'Desktop renderer build',
    root: path.join(repoRoot, '.vite', 'renderer', 'main_window'),
    required: false,
  },
];

const CATEGORY_ORDER = ['initial', 'runtime', 'worker', 'utility', 'lazy', 'other'];
const BUDGET_HEADROOM_BY_CATEGORY = {
  initial: 1.1,
  lazy: 1.15,
  utility: 1.15,
  worker: 1.1,
  runtime: 1,
  other: 1.1,
};

const UTILITY_CHUNK_PATTERNS = [
  /babel-/iu,
  /estree-/iu,
  /html-/iu,
  /marked/iu,
  /plugin-/iu,
  /postcss-/iu,
  /purify/iu,
  /spark-md5/iu,
  /standalone-/iu,
  /typescript-/iu,
];

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/');
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root) {
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  await walk(root);
  return files;
}

export function parseInitialAssetReferences(html) {
  const initial = new Set();
  const attrPattern = /\b(?:src|href)=["']([^"']+)["']/giu;
  let match;
  while ((match = attrPattern.exec(html)) !== null) {
    const value = match[1];
    if (!value) continue;
    if (!/\.(?:js|css)$/iu.test(value)) continue;
    initial.add(value.replace(/^\.\//u, '').replace(/^\//u, ''));
  }
  return initial;
}

export function classifyAsset(relativePath, initialAssets = new Set()) {
  const normalized = normalizeRelativePath(relativePath);
  const baseName = path.basename(normalized);
  if (initialAssets.has(normalized)) return 'initial';
  if (normalized.startsWith('pyodide/') || /\.(?:wasm|zip)$/iu.test(baseName)) {
    return 'runtime';
  }
  if (/worker/iu.test(baseName)) return 'worker';
  if (UTILITY_CHUNK_PATTERNS.some((pattern) => pattern.test(baseName))) {
    return 'utility';
  }
  if (normalized.startsWith('assets/') && /\.(?:js|css)$/iu.test(baseName)) {
    return 'lazy';
  }
  return 'other';
}

function createEmptyCategoryTotals() {
  return Object.fromEntries(
    CATEGORY_ORDER.map((category) => [
      category,
      { files: 0, bytes: 0, gzipBytes: 0 },
    ])
  );
}

function addToTotals(totals, category, bytes, gzipBytes) {
  const bucket = totals[category] ?? totals.other;
  bucket.files += 1;
  bucket.bytes += bytes;
  bucket.gzipBytes += gzipBytes;
}

export async function collectBuildTarget(target) {
  if (!(await pathExists(target.root))) {
    if (target.required) {
      throw new Error(
        `${target.label} output is missing at ${target.root}. Run the matching build before collecting performance metrics.`
      );
    }
    return {
      id: target.id,
      label: target.label,
      root: target.root,
      available: false,
      reason: 'missing-build-output',
      categories: createEmptyCategoryTotals(),
      assets: [],
      initialAssets: [],
    };
  }

  const htmlPath = path.join(target.root, 'index.html');
  const initialAssets = (await pathExists(htmlPath))
    ? parseInitialAssetReferences(await readFile(htmlPath, 'utf8'))
    : new Set();
  const files = await listFiles(target.root);
  const categories = createEmptyCategoryTotals();
  const assets = [];

  for (const filePath of files) {
    const relativePath = normalizeRelativePath(path.relative(target.root, filePath));
    const bytes = (await stat(filePath)).size;
    const gzipBytes = gzipSync(await readFile(filePath)).byteLength;
    const category = classifyAsset(relativePath, initialAssets);
    addToTotals(categories, category, bytes, gzipBytes);
    assets.push({ path: relativePath, category, bytes, gzipBytes });
  }

  assets.sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path));

  return {
    id: target.id,
    label: target.label,
    root: target.root,
    available: true,
    categories,
    assets,
    initialAssets: [...initialAssets].sort(),
  };
}

export function deriveBudgetsFromMeasurements(measurements) {
  const budgets = {};
  for (const target of measurements.targets) {
    if (!target.available) continue;
    budgets[target.id] = {};
    for (const category of CATEGORY_ORDER) {
      const total = target.categories[category];
      const multiplier = BUDGET_HEADROOM_BY_CATEGORY[category] ?? 1.1;
      budgets[target.id][category] = {
        files: total.files,
        baselineBytes: total.bytes,
        baselineGzipBytes: total.gzipBytes,
        maxBytes: Math.ceil(total.bytes * multiplier),
        maxGzipBytes: Math.ceil(total.gzipBytes * multiplier),
      };
    }
  }
  return budgets;
}

export function compareWithBudgets(measurements, baseline, { requireAllTargets = false } = {}) {
  const violations = [];
  const targetById = new Map(measurements.targets.map((target) => [target.id, target]));
  const baselineBudgets = baseline?.budgets ?? {};

  for (const [targetId, categoryBudgets] of Object.entries(baselineBudgets)) {
    const target = targetById.get(targetId);
    if (!target?.available) {
      if (requireAllTargets) {
        violations.push({
          target: targetId,
          category: 'target',
          metric: 'available',
          actual: 0,
          max: 1,
          message: `${targetId} build output is missing`,
        });
      }
      continue;
    }

    for (const [category, budget] of Object.entries(categoryBudgets)) {
      const total = target.categories[category];
      if (!total) continue;
      for (const metric of ['bytes', 'gzipBytes']) {
        const maxKey = metric === 'bytes' ? 'maxBytes' : 'maxGzipBytes';
        const max = budget[maxKey];
        if (typeof max !== 'number') {
          violations.push({
            target: targetId,
            category,
            metric,
            actual: total[metric],
            max: Number.NaN,
            // Use the same `metric` token in both message branches so log
            // greps for `${target}.${category}.${metric}` catch both the
            // missing-baseline and exceeded-budget cases.
            message: `${targetId}.${category}.${metric} budget (${maxKey}) is missing or invalid in the baseline`,
          });
          continue;
        }
        if (total[metric] > max) {
          violations.push({
            target: targetId,
            category,
            metric,
            actual: total[metric],
            max,
            message: `${targetId}.${category}.${metric} ${total[metric]} exceeds ${max}`,
          });
        }
      }
    }
  }

  return violations;
}

export function validateBaseline(baseline) {
  if (!baseline || typeof baseline !== 'object') {
    throw new Error('Performance baseline must be a JSON object.');
  }
  if (baseline.schemaVersion !== 1) {
    throw new Error('Performance baseline schemaVersion must be 1.');
  }
  if (!baseline.budgets || typeof baseline.budgets !== 'object') {
    throw new Error('Performance baseline is missing budgets.');
  }
}

export async function buildPerformanceReport({
  baselinePath = DEFAULT_BASELINE_PATH,
  targets = DEFAULT_TARGETS,
  check = false,
  requireAllTargets = false,
} = {}) {
  const measurements = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    targets: [],
  };

  for (const target of targets) {
    measurements.targets.push(await collectBuildTarget(target));
  }

  let baseline = null;
  if (await pathExists(baselinePath)) {
    baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    validateBaseline(baseline);
  } else if (check) {
    throw new Error(`Performance baseline missing at ${baselinePath}.`);
  }

  const budgets = baseline?.budgets ?? deriveBudgetsFromMeasurements(measurements);
  const violations = baseline
    ? compareWithBudgets(measurements, baseline, { requireAllTargets })
    : [];

  return {
    schemaVersion: measurements.schemaVersion,
    generatedAt: measurements.generatedAt,
    targets: measurements.targets,
    measurements: measurements.targets,
    budgets,
    violations,
    baselinePath,
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'n/a';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

export function renderConsoleTable(report) {
  const lines = [];
  lines.push('Lingua performance report');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');

  for (const target of report.targets) {
    lines.push(`${target.label} (${target.id})`);
    if (!target.available) {
      lines.push(`  unavailable: ${target.reason}`);
      lines.push('');
      continue;
    }
    lines.push('  category  files       raw      gzip');
    for (const category of CATEGORY_ORDER) {
      const total = target.categories[category];
      lines.push(
        `  ${category.padEnd(8)} ${String(total.files).padStart(5)} ${formatBytes(total.bytes).padStart(9)} ${formatBytes(total.gzipBytes).padStart(9)}`
      );
    }
    lines.push('');
  }

  if (report.violations.length === 0) {
    lines.push('Budget result: pass');
  } else {
    lines.push('Budget result: fail');
    for (const violation of report.violations) {
      lines.push(`- ${violation.message}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function renderMarkdownReport(report) {
  const lines = [];
  lines.push('# Lingua Performance Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');

  for (const target of report.targets) {
    lines.push(`## ${target.label}`);
    lines.push('');
    if (!target.available) {
      lines.push(`Unavailable: ${target.reason}.`);
      lines.push('');
      continue;
    }
    lines.push('| Category | Files | Raw | Gzip |');
    lines.push('|---|---:|---:|---:|');
    for (const category of CATEGORY_ORDER) {
      const total = target.categories[category];
      lines.push(
        `| ${category} | ${total.files} | ${formatBytes(total.bytes)} | ${formatBytes(total.gzipBytes)} |`
      );
    }
    lines.push('');
    lines.push('Largest assets:');
    for (const asset of target.assets.slice(0, 10)) {
      lines.push(
        `- ${asset.path} (${asset.category}) - ${formatBytes(asset.bytes)} raw, ${formatBytes(asset.gzipBytes)} gzip`
      );
    }
    lines.push('');
  }

  lines.push('## Budget Result');
  lines.push('');
  if (report.violations.length === 0) {
    lines.push('Pass.');
  } else {
    lines.push('Fail.');
    for (const violation of report.violations) {
      lines.push(`- ${violation.message}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function createBaseline(report) {
  return {
    schemaVersion: 1,
    generatedAt: report.generatedAt,
    note: 'Generated by npm run performance:baseline. Budgets use current measurements plus per-category headroom.',
    budgets: deriveBudgetsFromMeasurements(report),
  };
}

export function assertAllTargetsAvailable(report) {
  const missingTargets = report.targets.filter((target) => !target.available);
  if (missingTargets.length === 0) return;

  throw new Error(
    `Cannot refresh performance baseline because build output is missing for: ${missingTargets
      .map((target) => target.id)
      .join(', ')}. Run the matching builds first.`
  );
}

function parseArgs(argv) {
  return {
    check: argv.includes('--check'),
    writeBaseline: argv.includes('--write-baseline'),
    requireAllTargets: argv.includes('--require-all-targets'),
    outputDir:
      argv.find((arg) => arg.startsWith('--output-dir='))?.slice('--output-dir='.length) ??
      DEFAULT_OUTPUT_DIR,
    baselinePath:
      argv.find((arg) => arg.startsWith('--baseline='))?.slice('--baseline='.length) ??
      DEFAULT_BASELINE_PATH,
  };
}

async function writeReportArtifacts(report, outputDir) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, 'performance-report.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );
  await writeFile(
    path.join(outputDir, 'performance-report.md'),
    renderMarkdownReport(report),
    'utf8'
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildPerformanceReport({
    baselinePath: path.resolve(options.baselinePath),
    check: options.check,
    requireAllTargets: options.requireAllTargets,
  });

  if (options.writeBaseline) {
    if (options.requireAllTargets) {
      assertAllTargetsAvailable(report);
    }
    const baseline = createBaseline(report);
    await mkdir(path.dirname(path.resolve(options.baselinePath)), { recursive: true });
    await writeFile(
      path.resolve(options.baselinePath),
      `${JSON.stringify(baseline, null, 2)}\n`,
      'utf8'
    );
  }

  await writeReportArtifacts(report, path.resolve(options.outputDir));
  process.stdout.write(renderConsoleTable(report));

  if (options.check && report.violations.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    // Preserve the stack trace so CI logs surface the failing line, not
    // just the message. Falls back to the message when stack is missing
    // (non-Error throws) and to String(error) for non-Error values.
    if (error instanceof Error) {
      console.error(error.stack ?? error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  });
}
