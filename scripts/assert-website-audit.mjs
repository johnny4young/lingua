#!/usr/bin/env node

/**
 * Blocking production audit for website/package-lock.json. Runs
 * `npm audit --omit=dev --json` and fails on any high or critical advisory
 * except the reviewed, unexpired entries in website-audit-exceptions.json.
 *
 *   node scripts/assert-website-audit.mjs                 # live audit
 *   node scripts/assert-website-audit.mjs --fixture <f>   # saved payload
 */

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { stripArgSeparator } from './lib/cli-args.mjs';
import { evaluateWebsiteAudit } from './lib/websiteAudit.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  args: stripArgSeparator(process.argv.slice(2)),
  options: {
    fixture: { type: 'string' },
    exceptions: { type: 'string', default: path.join(repoRoot, 'scripts/website-audit-exceptions.json') },
    now: { type: 'string' },
  },
  strict: true,
});

function readAudit() {
  if (values.fixture) return readFile(values.fixture, 'utf8');
  const result = spawnSync(
    'npm',
    ['--prefix', 'website', 'audit', '--package-lock-only', '--omit=dev', '--json'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' }
  );
  if (result.error) throw result.error;
  return result.stdout;
}

let audit;
try {
  audit = JSON.parse(await readAudit());
} catch (error) {
  console.error(`website-audit: could not read the npm audit payload (${error.message})`);
  process.exit(1);
}
const { exceptions } = JSON.parse(await readFile(values.exceptions, 'utf8'));
const result = evaluateWebsiteAudit(audit, {
  exceptions,
  ...(values.now ? { now: new Date(values.now) } : {}),
});

for (const id of result.expired) {
  console.error(`website-audit: exception ${id} has expired; re-review it in ${path.relative(repoRoot, values.exceptions)}`);
}
for (const item of result.excused) {
  console.log(`website-audit: excused ${item.name} (${item.advisories.join(', ')})`);
}
if (result.error) {
  console.error(`website-audit: ${result.error}`);
  process.exit(1);
}
if (!result.ok) {
  for (const item of result.offending) {
    console.error(`website-audit: ${item.severity} ${item.name} ${item.advisories.join(', ')}`);
  }
  process.exit(1);
}
console.log('website-audit: ok');
