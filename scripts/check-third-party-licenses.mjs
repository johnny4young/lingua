#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const APPROVED_LICENSE_EXPRESSIONS = [
  '(MPL-2.0 OR Apache-2.0)',
  '(WTFPL OR MIT)',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  'Python-2.0',
];

const BLOCKED_LICENSE_PATTERN =
  /\b(AGPL|GPL|LGPL|SSPL|BUSL|Elastic-2\.0|Commons-Clause|LicenseRef-Commercial|Commercial|Proprietary)\b/i;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function packageNameFromLockPath(packagePath) {
  const tail = packagePath.split('node_modules/').at(-1) ?? packagePath;
  const parts = tail.split('/');
  return parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

function normalizeLicense(value) {
  if (!value) return 'UNKNOWN';
  if (typeof value === 'string') return value.trim() || 'UNKNOWN';
  if (Array.isArray(value)) {
    const licenses = value.map(item => normalizeLicense(item)).filter(item => item !== 'UNKNOWN');
    return licenses.length ? licenses.join(' OR ') : 'UNKNOWN';
  }
  if (typeof value === 'object') return normalizeLicense(value.type);
  return 'UNKNOWN';
}

function readPackageMetadata(root, packagePath, meta) {
  const packageJsonPath = path.join(root, packagePath, 'package.json');
  const fallbackName = meta.name ?? packageNameFromLockPath(packagePath);
  const fallbackVersion = meta.version ?? '0.0.0';
  const fallbackLicense = normalizeLicense(meta.license);

  if (!fs.existsSync(packageJsonPath)) {
    return {
      name: fallbackName,
      version: fallbackVersion,
      license: fallbackLicense,
      path: packagePath,
      missingPackageJson: true,
    };
  }

  const packageJson = readJson(packageJsonPath);
  return {
    name: packageJson.name ?? fallbackName,
    version: packageJson.version ?? fallbackVersion,
    license: normalizeLicense(packageJson.license ?? packageJson.licenses ?? meta.license),
    path: packagePath,
    missingPackageJson: false,
  };
}

export function collectLicenseEntries({ root = process.cwd(), includeDev = false } = {}) {
  const lock = readJson(path.join(root, 'package-lock.json'));
  const entries = [];

  for (const [packagePath, meta] of Object.entries(lock.packages ?? {})) {
    if (!packagePath) continue;
    if (!includeDev && meta.dev) continue;
    if (!packagePath.startsWith('node_modules/')) continue;
    entries.push(readPackageMetadata(root, packagePath, meta));
  }

  entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return entries;
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
  const scope = includeDev ? 'all package-lock entries, including dev-only packages' : 'production package-lock entries only';
  const lines = [
    '# Third-Party License Report',
    '',
    'Generated from `package-lock.json` plus installed package metadata.',
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
    '| Package | Version | License | Lockfile path |',
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
      `Reviewed ${entries.length} ${args.includeDev ? 'total' : 'production'} package-lock entries.`,
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
