#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  collectLicenseEntries,
  renderMarkdownReport,
  reviewLicenseEntry,
} from './check-third-party-licenses.mjs';

const outputDir = process.argv[2] ?? 'output/release-compliance';
const sbomPath = path.join(outputDir, 'lingua-sbom.cyclonedx.json');
const reportPath = path.join(outputDir, 'THIRD_PARTY_LICENSE_REPORT.md');

fs.mkdirSync(outputDir, { recursive: true });

const entries = collectLicenseEntries();
const problems = entries
  .map(entry => ({ entry, review: reviewLicenseEntry(entry) }))
  .filter(({ review }) => !review.ok);

if (problems.length > 0) {
  for (const { entry, review } of problems) {
    process.stderr.write(`${entry.name}@${entry.version}: ${review.reason}\n`);
  }
  process.exit(1);
}

const sbom = execFileSync(
  'npm',
  [
    'sbom',
    '--omit=dev',
    '--sbom-format',
    'cyclonedx',
    '--sbom-type',
    'application',
    '--package-lock-only',
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);

JSON.parse(sbom);
fs.writeFileSync(sbomPath, sbom);
fs.writeFileSync(reportPath, renderMarkdownReport(entries));

process.stdout.write(`Wrote ${sbomPath}\n`);
process.stdout.write(`Wrote ${reportPath}\n`);
