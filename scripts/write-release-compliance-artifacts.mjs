#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectLicenseEntries,
  renderMarkdownReport,
  reviewLicenseEntry,
} from './check-third-party-licenses.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
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

/**
 * Build a CycloneDX 1.5 SBOM from the production license entries.
 *
 * Replaces the former `npm sbom --package-lock-only` call after the
 * pnpm migration (pnpm has no built-in sbom command). The component
 * set is the same prod dependency tree the license gate reviews, so
 * the SBOM and the THIRD_PARTY_LICENSE_REPORT stay in lockstep by
 * construction. Deterministic: entries arrive name/version-sorted and
 * are de-duplicated by name@version.
 */
function toPurl(name, version) {
  if (name.startsWith('@')) {
    const [scope, pkg = ''] = name.split('/');
    return `pkg:npm/${encodeURIComponent(scope)}/${pkg}@${version}`;
  }
  return `pkg:npm/${name}@${version}`;
}

function buildCycloneDxSbom(licenseEntries, appMeta) {
  const seen = new Set();
  const components = [];
  for (const entry of licenseEntries) {
    const key = `${entry.name}@${entry.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    components.push({
      type: 'library',
      name: entry.name,
      version: entry.version,
      purl: toPurl(entry.name, entry.version),
      ...(entry.license && entry.license !== 'UNKNOWN'
        ? { licenses: [{ expression: entry.license }] }
        : {}),
    });
  }

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      // No timestamp: keep the SBOM byte-stable across runs so a
      // re-generation in CI does not churn the committed/uploaded
      // artifact. The release tag in the surrounding pipeline carries
      // the provenance.
      component: {
        type: 'application',
        name: appMeta.name,
        version: appMeta.version,
      },
      tools: [{ vendor: 'lingua', name: 'write-release-compliance-artifacts', version: appMeta.version }],
    },
    components,
  };
}

const rootPkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
);
const sbom = buildCycloneDxSbom(entries, {
  name: rootPkg.name ?? 'lingua',
  version: rootPkg.version ?? '0.0.0',
});

fs.writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`);
fs.writeFileSync(reportPath, renderMarkdownReport(entries));

process.stdout.write(`Wrote ${sbomPath}\n`);
process.stdout.write(`Wrote ${reportPath}\n`);
