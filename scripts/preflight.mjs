#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { stripArgSeparator } from './lib/cli-args.mjs';
import { isDirectInvocation } from './lib/isDirectInvocation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Deterministic CI gates that fail small PRs most often. Every command must
 * appear verbatim in .github/workflows/ci.yml (tests/scripts/preflight.test.ts).
 * `full` gates need a production build and stay out of the pre-push hook.
 */
export const GATES = [
  { name: 'changelog', steps: [['pnpm', 'run', 'changelog:check']] },
  { name: 'typecheck', steps: [['pnpm', 'exec', 'tsc', '--noEmit']] },
  { name: 'typecheck:tests', steps: [['pnpm', 'run', 'typecheck:tests']] },
  { name: 'lint', steps: [['pnpm', 'run', 'lint']] },
  { name: 'i18n', steps: [['pnpm', 'run', 'check:i18n']] },
  { name: 'i18n:copy', steps: [['pnpm', 'run', 'check:i18n:copy']] },
  {
    name: 'deadcode',
    steps: [['pnpm', 'run', 'check:deadcode']],
    requires: ['website/node_modules', 'license-server/node_modules', 'update-server/node_modules'],
  },
  {
    name: 'web-budget',
    full: true,
    steps: [
      ['pnpm', 'run', 'build:web'],
      ['pnpm', 'run', 'check:performance', '--fail-on-slack'],
    ],
    env: { NODE_OPTIONS: '--max-old-space-size=8192' },
  },
];

export function selectGates(gates, { full = false, only = [] } = {}) {
  if (only.length > 0) {
    const unknown = only.filter((name) => !gates.some((gate) => gate.name === name));
    if (unknown.length > 0) {
      throw new Error(`Unknown gate(s): ${unknown.join(', ')}. Known: ${gates.map((g) => g.name).join(', ')}`);
    }
    return gates.filter((gate) => only.includes(gate.name));
  }
  return gates.filter((gate) => full || !gate.full);
}

export function missingRequirements(gate, root = repoRoot) {
  return (gate.requires ?? []).filter((entry) => !existsSync(path.join(root, entry)));
}

function runStep(step, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(step[0], step.slice(1), {
      cwd,
      env: { ...process.env, ...env, FORCE_COLOR: '0' },
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (error) => resolve({ code: 1, output: `${output}${error.message}\n` }));
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

async function runGate(gate, cwd) {
  const started = performance.now();
  let output = '';
  for (const step of gate.steps) {
    const result = await runStep(step, { cwd, env: gate.env });
    output += result.output;
    if (result.code !== 0) {
      return { gate, ok: false, output, failedStep: step.join(' '), ms: performance.now() - started };
    }
  }
  return { gate, ok: true, output, ms: performance.now() - started };
}

async function runPool(gates, jobs, cwd, onResult) {
  const queue = [...gates];
  const results = [];
  const worker = async () => {
    while (queue.length > 0) {
      const result = await runGate(queue.shift(), cwd);
      results.push(result);
      onResult(result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, gates.length) }, worker));
  return results;
}

function tail(text, lines = 40) {
  return text.trimEnd().split(/\r?\n/u).slice(-lines).join('\n');
}

function printHelp() {
  console.log(`Usage: pnpm run preflight [--full] [--only <gate,...>] [--jobs <n>]

Runs the static CI gates locally and reports every failure, not only the first.
--full adds the web build and performance budget. The pre-push hook runs the
default set; skip it once with git push --no-verify.

Gates: ${GATES.map((gate) => `${gate.name}${gate.full ? ' (full)' : ''}`).join(', ')}`);
}

export async function main(argv = process.argv.slice(2), { cwd = repoRoot } = {}) {
  const { values } = parseArgs({
    args: stripArgSeparator(argv),
    options: {
      full: { type: 'boolean', default: false },
      only: { type: 'string' },
      jobs: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    printHelp();
    return 0;
  }

  const only = values.only ? values.only.split(',').map((name) => name.trim()).filter(Boolean) : [];
  const selected = selectGates(GATES, { full: values.full, only });
  const runnable = [];
  for (const gate of selected) {
    const missing = missingRequirements(gate, cwd);
    if (missing.length > 0) {
      console.log(`- ${gate.name} skipped: install ${missing.join(', ')} first (CI still runs it)`);
    } else {
      runnable.push(gate);
    }
  }
  if (runnable.length === 0) {
    console.error('preflight: no gate could run.');
    return 1;
  }

  const jobs = Number(values.jobs) || Math.max(1, Math.min(4, os.availableParallelism() - 1));
  const sequential = runnable.filter((gate) => gate.full);
  const parallel = runnable.filter((gate) => !gate.full);
  const report = (result) => {
    const seconds = (result.ms / 1000).toFixed(1);
    console.log(`${result.ok ? '✓' : '✗'} ${result.gate.name} (${seconds}s)`);
  };
  // The first pnpm run may install stale or missing deps; parallel gates would race that install.
  const [warmup, ...rest] = parallel;
  const results = [
    ...(await runPool(warmup ? [warmup] : [], 1, cwd, report)),
    ...(await runPool(rest, jobs, cwd, report)),
    ...(await runPool(sequential, 1, cwd, report)),
  ];

  const failed = results.filter((result) => !result.ok);
  for (const result of failed) {
    console.error(`\n── ${result.gate.name}: ${result.failedStep}\n${tail(result.output)}`);
  }
  if (failed.length > 0) {
    console.error(
      `\npreflight: ${failed.length} gate(s) failed: ${failed.map((r) => r.gate.name).join(', ')}. Rerun one with --only <gate>.`
    );
    return 1;
  }
  console.log(`preflight: ${results.length} gate(s) passed.`);
  return 0;
}

if (isDirectInvocation(import.meta.url)) {
  process.exitCode = await main();
}
