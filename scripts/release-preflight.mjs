#!/usr/bin/env node

/**
 * Release preflight — run the release-blocking gates LOCALLY, the way CI runs
 * them, before triggering the Release workflow.
 *
 * Motivation: the v0.7.0 release broke twice in CI, each time after expensive,
 * partly-irreversible work (a pushed tag, a 4-minute signed macOS build, a
 * published draft Release). Both breaks were detectable beforehand — one was a
 * gate whose logic differed local-vs-CI (license rotation read a gitignored
 * `.env` that CI never has), the other an infra gate (R2 public access / CORS)
 * that only ran at deploy time. This command runs every runnable gate up front,
 * CI-faithfully, so the maintainer sees green BEFORE dispatching the workflow.
 *
 * The gate list lives in `scripts/lib/releasePreflightGates.mjs` and is pinned
 * against the workflows by `tests/scripts/releasePreflight.test.ts` so it
 * cannot silently drift.
 *
 * Usage:
 *   pnpm run release:preflight                # full preflight for v<package.json version>
 *   pnpm run release:preflight -- --tag v0.7.0
 *   pnpm run release:preflight -- --fast       # skip the heavy gates (test, build:web)
 *   pnpm run release:preflight -- --with-smoke # also run the offline desktop smoke
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { stripArgSeparator } from './lib/cli-args.mjs';
import { PREFLIGHT_GATES } from './lib/releasePreflightGates.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// A path that must not exist, so the rotation gate sees an absent dev `.env`
// exactly like CI. Guarded below in case someone literally creates it.
const ABSENT_ENV_PATH = path.join(repoRoot, '.preflight-absent-env.DO-NOT-CREATE');

function printHelp() {
  console.log(`Usage: pnpm run release:preflight -- [--tag vX.Y.Z] [--fast] [--with-smoke]

Runs the runnable release-blocking gates locally, CI-faithfully, before you
dispatch the Release workflow. Exit 0 = safe to release; exit 1 = fix first.

  --tag <vX.Y.Z>  Target release tag. Default: v<package.json version>.
  --fast          Skip the heavy gates (tests, web build) for a quick re-check.
  --with-smoke    Also run the opt-in offline desktop smoke.`);
}

export function resolveTag(explicitTag, packageVersion) {
  if (explicitTag) return explicitTag.startsWith('v') ? explicitTag : `v${explicitTag}`;
  return `v${packageVersion}`;
}

function buildArgv(gate, { tag }) {
  return gate.argv.map((part) => {
    if (part === '__TAG__') return tag;
    if (part === '__NO_ENV__') return ABSENT_ENV_PATH;
    return part;
  });
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: stripArgSeparator(argv),
    options: {
      tag: { type: 'string' },
      fast: { type: 'boolean', default: false },
      'with-smoke': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    printHelp();
    return 0;
  }

  if (existsSync(ABSENT_ENV_PATH)) {
    console.error(
      `release-preflight: ${ABSENT_ENV_PATH} unexpectedly exists; remove it so the rotation gate can simulate an absent .env.`
    );
    return 1;
  }

  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const tag = resolveTag(values.tag, packageJson.version);

  const gates = PREFLIGHT_GATES.filter((gate) => {
    if (gate.optional && !values['with-smoke']) return false;
    if (gate.heavy && values.fast) return false;
    return true;
  });

  console.log(`release-preflight: target ${tag} — ${gates.length} gate(s)${values.fast ? ' (fast)' : ''}\n`);

  const results = [];
  for (const gate of gates) {
    const argvForGate = buildArgv(gate, { tag });
    console.log(`\n=== ${gate.label} ===${gate.note ? `\n    (${gate.note})` : ''}`);
    const started = process.hrtime.bigint();
    const run = spawnSync(argvForGate[0], argvForGate.slice(1), {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });
    const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
    const ok = run.status === 0 && run.error === undefined;
    results.push({ id: gate.id, label: gate.label, ok, ms });
  }

  console.log('\n──────── release preflight summary ────────');
  for (const result of results) {
    const mark = result.ok ? 'PASS' : 'FAIL';
    console.log(`  ${mark}  ${result.label}  (${(result.ms / 1000).toFixed(1)}s)`);
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.error(
      `\nrelease-preflight: ${failed.length} gate(s) failed — fix before dispatching the Release workflow:`
    );
    for (const result of failed) console.error(`  - ${result.id}`);
    return 1;
  }
  console.log(`\nrelease-preflight: all gates green for ${tag}. Safe to dispatch the Release workflow.`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
