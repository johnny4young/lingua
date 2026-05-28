#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const APPROVED_LICENSE_EXPRESSIONS = [
  '(MPL-2.0 OR Apache-2.0)',
  '(WTFPL OR MIT)',
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  // Permissive dual-license; both halves are already individually
  // approved. Surfaced by @bjorn3/browser_wasi_shim (RL-042 Ruby WASI)
  // once pnpm's license resolver reported the SPDX expression verbatim.
  'MIT OR Apache-2.0',
  'MPL-2.0',
  'Python-2.0',
  // Public-domain-equivalent permissive license (same posture as the
  // already-approved CC0-1.0 / 0BSD). Surfaced by robust-predicates,
  // a transitive d3/vega dependency (RL-044 charts).
  'Unlicense',
];

const BLOCKED_LICENSE_PATTERN =
  /\b(AGPL|GPL|LGPL|SSPL|BUSL|Elastic-2\.0|Commons-Clause|LicenseRef-Commercial|Commercial|Proprietary)\b/i;

function normalizeLicense(value) {
  if (!value) return 'UNKNOWN';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // pnpm reports unresolved licenses as the literal 'Unknown'.
    if (!trimmed || /^unknown$/i.test(trimmed)) return 'UNKNOWN';
    return trimmed;
  }
  if (Array.isArray(value)) {
    const licenses = value.map(item => normalizeLicense(item)).filter(item => item !== 'UNKNOWN');
    return licenses.length ? licenses.join(' OR ') : 'UNKNOWN';
  }
  if (typeof value === 'object') return normalizeLicense(value.type);
  return 'UNKNOWN';
}

/**
 * Reduce a pnpm store path to a stable, repo-relative-ish identifier
 * for the report (the `.pnpm/<name>@<ver>/node_modules/<name>` virtual
 * store path is noisy; keep just the trailing `node_modules/<name>`).
 */
function shortPackagePath(storePath, name) {
  if (typeof storePath !== 'string' || storePath.length === 0) {
    return `node_modules/${name}`;
  }
  const idx = storePath.lastIndexOf('node_modules/');
  return idx >= 0 ? storePath.slice(idx) : storePath;
}

/**
 * Map the output of `pnpm licenses list --json` to the flat license
 * entry shape the policy review + report consume. pnpm groups by
 * license expression; each package carries parallel `versions[]` and
 * `paths[]` arrays (one entry per resolved version in the tree).
 */
export function entriesFromPnpmLicenses(data) {
  const entries = [];
  for (const packages of Object.values(data ?? {})) {
    if (!Array.isArray(packages)) continue;
    for (const pkg of packages) {
      const name = pkg.name ?? 'unknown';
      const license = normalizeLicense(pkg.license);
      const versions =
        Array.isArray(pkg.versions) && pkg.versions.length > 0
          ? pkg.versions
          : ['0.0.0'];
      const paths = Array.isArray(pkg.paths) ? pkg.paths : [];
      versions.forEach((version, i) => {
        entries.push({
          name,
          version,
          license,
          path: shortPackagePath(paths[i] ?? paths[0], name),
          missingPackageJson: false,
        });
      });
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return entries;
}

/**
 * Enumerate installed third-party packages + their licenses via pnpm.
 * Replaces the former package-lock.json walk after the pnpm migration —
 * `pnpm licenses list --json` resolves the prod/dev split and the
 * license expression for us. Requires node_modules to be installed
 * (CI installs before this gate runs).
 */
export function collectLicenseEntries({ root = process.cwd(), includeDev = false } = {}) {
  const args = ['licenses', 'list', '--json'];
  if (!includeDev) args.push('--prod');
  const raw = execFileSync('pnpm', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const data = raw.trim().length > 0 ? JSON.parse(raw) : {};
  return entriesFromPnpmLicenses(data);
}

export function reviewLicenseEntry(entry) {
  if (entry.missingPackageJson) {
    return {
      ok: false,
      reason: `missing package metadata at ${entry.path}/package.json`,
    };
  }

  if (entry.license === 'UNKNOWN') {
    return { ok: false, reason: 'missing license metadata' };
  }

  if (BLOCKED_LICENSE_PATTERN.test(entry.license)) {
    return { ok: false, reason: `blocked license expression: ${entry.license}` };
  }

  if (!APPROVED_LICENSE_EXPRESSIONS.includes(entry.license)) {
    return { ok: false, reason: `unreviewed license expression: ${entry.license}` };
  }

  return { ok: true };
}

export function summarizeLicenses(entries) {
  const counts = new Map();
  for (const entry of entries) {
    counts.set(entry.license, (counts.get(entry.license) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function renderMarkdownReport(entries, { includeDev = false } = {}) {
  const problems = entries
    .map(entry => ({ entry, review: reviewLicenseEntry(entry) }))
    .filter(({ review }) => !review.ok);
  const scope = includeDev ? 'all installed dependencies, including dev-only packages' : 'production dependencies only';
  const lines = [
    '# Third-Party License Report',
    '',
    'Generated from `pnpm licenses list` across the installed dependency tree.',
    '',
    `Scope: ${scope}.`,
    `Packages reviewed: ${entries.length}.`,
    `Policy result: ${problems.length === 0 ? 'pass' : 'fail'}.`,
    '',
    '## License Summary',
    '',
    '| License expression | Packages |',
    '| --- | ---: |',
    ...summarizeLicenses(entries).map(([license, count]) => `| \`${license}\` | ${count} |`),
    '',
    '## License Policy',
    '',
    'The public-release gate allows only these reviewed license expressions for packaged runtime dependencies:',
    '',
    ...APPROVED_LICENSE_EXPRESSIONS.map(license => `- \`${license}\``),
    '',
    'Any missing, unreviewed, AGPL/GPL/LGPL/SSPL, commercial, or proprietary license expression fails the gate until it is reviewed and either removed or explicitly approved.',
    '',
    '## Package Inventory',
    '',
    '| Package | Version | License | Install path |',
    '| --- | --- | --- | --- |',
    ...entries.map(
      entry =>
        `| \`${entry.name}\` | \`${entry.version}\` | \`${entry.license}\` | \`${entry.path}\` |`,
    ),
    '',
  ];

  if (problems.length > 0) {
    lines.push('## Policy Failures', '');
    for (const { entry, review } of problems) {
      lines.push(`- \`${entry.name}@${entry.version}\`: ${review.reason}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const args = {
    check: false,
    format: 'summary',
    includeDev: false,
    write: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      args.check = true;
    } else if (arg === '--include-dev') {
      args.includeDev = true;
    } else if (arg === '--format') {
      args.format = argv[++i] ?? '';
    } else if (arg === '--write') {
      args.write = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!['summary', 'json', 'markdown'].includes(args.format)) {
    throw new Error(`Unsupported --format value: ${args.format}`);
  }

  if (args.write && args.format === 'summary') {
    throw new Error('--write requires --format json or --format markdown');
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const entries = collectLicenseEntries({ includeDev: args.includeDev });
  const problems = entries
    .map(entry => ({ entry, review: reviewLicenseEntry(entry) }))
    .filter(({ review }) => !review.ok);

  let output;
  if (args.format === 'json') {
    output = `${JSON.stringify({ entries, problems }, null, 2)}\n`;
  } else if (args.format === 'markdown') {
    output = renderMarkdownReport(entries, { includeDev: args.includeDev });
  } else {
    output = [
      `Reviewed ${entries.length} ${args.includeDev ? 'total' : 'production'} dependencies.`,
      `License policy: ${problems.length === 0 ? 'pass' : 'fail'}.`,
      ...summarizeLicenses(entries).map(([license, count]) => `- ${license}: ${count}`),
      '',
    ].join('\n');
  }

  if (args.write) {
    fs.mkdirSync(path.dirname(args.write), { recursive: true });
    fs.writeFileSync(args.write, output);
  } else {
    process.stdout.write(output);
  }

  if (problems.length > 0) {
    for (const { entry, review } of problems) {
      process.stderr.write(`${entry.name}@${entry.version}: ${review.reason}\n`);
    }
    process.exitCode = 1;
  } else if (args.check) {
    process.stdout.write('Third-party license policy passed.\n');
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main();
}
