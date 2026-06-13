#!/usr/bin/env node

/**
 * RL-145 release/PR-time guard: fail closed when the PRODUCTION dependency
 * graph carries an advisory at or above a severity threshold (default high).
 *
 * What this closes: the blocking `pnpm audit --prod` gate existed only at
 * release time (RL-080's release.yml). PR CI ran the full audit as advisory
 * (`continue-on-error`), so a prod high-severity dependency could merge with
 * nothing but a warning. This script is the single tested mechanism wired into
 * both ci.yml (PR gate) and release.yml.
 *
 * Modes:
 *   - default: spawn `pnpm audit --prod --json`, capturing stdout regardless
 *     of pnpm's own exit code, then apply our own threshold via
 *     scripts/lib/prodAudit.mjs.
 *   - `--fixture <path>`: read a saved audit JSON instead of spawning pnpm, so
 *     the "synthetic high advisory fails CI" acceptance criterion is provable
 *     in tests/scripts/prodAudit.test.ts without a live registry advisory.
 *
 * Fail-closed: a spawn failure, a non-zero pnpm exit with no JSON, or an
 * unparseable payload exits 1 with a named error — we never green-light an
 * audit we could not actually read. (Fail-soft was the rejected option B.)
 *
 * The full (dev-inclusive) audit stays advisory elsewhere by design; see
 * docs/RELEASE_SECURITY.md for the prod-vs-full split rationale.
 */

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { stripArgSeparator } from './lib/cli-args.mjs';
import {
  DEFAULT_AUDIT_LEVEL,
  evaluateProdAudit,
  formatProdAuditFailure,
} from './lib/prodAudit.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

/**
 * Run `pnpm audit --prod --json` and return its stdout. `pnpm audit` exits
 * non-zero when advisories are found, but still prints the full JSON payload
 * to stdout — so we capture stdout on every exit code and let the pure
 * evaluator apply our threshold. Throws (fail-closed) only when the process
 * could not run or produced no stdout at all.
 *
 * @returns {string}
 */
function runPnpmAudit() {
  const result = spawnSync('pnpm', ['audit', '--prod', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`Could not run pnpm audit: ${result.error.message}`);
  }
  if (!result.stdout || result.stdout.trim().length === 0) {
    const stderr = (result.stderr ?? '').trim();
    throw new Error(
      `pnpm audit produced no JSON output (exit ${result.status}).${stderr ? ` stderr: ${stderr}` : ''}`
    );
  }
  return result.stdout;
}

function printHelp() {
  console.log(`Usage: node scripts/assert-prod-audit.mjs [options]

Fails closed when the production dependency graph carries an advisory at or
above the threshold. Runs in ci.yml (PR gate) and release.yml.

Options:
  --level <severity>  Block at/above this severity. Default: ${DEFAULT_AUDIT_LEVEL}
                      (one of: info, low, moderate, high, critical)
  --fixture <path>    Read audit JSON from a file instead of running pnpm
                      (test mode). Production runs omit this.
`);
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: stripArgSeparator(argv),
    options: {
      level: { type: 'string' },
      fixture: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    printHelp();
    return 0;
  }

  const level = values.level ?? DEFAULT_AUDIT_LEVEL;

  let rawJson;
  if (values.fixture) {
    rawJson = await readFile(path.resolve(values.fixture), 'utf8');
  } else {
    rawJson = runPnpmAudit();
  }

  let audit;
  try {
    audit = JSON.parse(rawJson);
  } catch (error) {
    // Fail-closed: an unparseable payload means we cannot verify the graph.
    console.error(
      `prod-audit: could not parse audit JSON: ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }

  const result = evaluateProdAudit(audit, { level });

  if (result.error === 'malformed') {
    console.error(`prod-audit: ${result.message}`);
    return 1;
  }

  if (!result.ok) {
    console.error(formatProdAuditFailure(result));
    return 1;
  }

  // `counts` is the PRODUCTION graph metadata (we ran `pnpm audit --prod`),
  // so high/critical are 0 here on success. The dev-inclusive full-graph
  // highs are gated separately as advisory — see docs/RELEASE_SECURITY.md.
  const { high, critical } = result.counts;
  console.log(
    `prod-audit: ok (production graph: 0 advisories at or above ${result.level}; high=${high} critical=${critical})`
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  );
}
