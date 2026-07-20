/**
 * implementation — bundled CJS integration tests.
 *
 * Spawns `dist/cli/lingua.cjs` via `child_process.spawnSync` to
 * verify the artifact actually runs end-to-end. Skips automatically
 * when the bundle is missing (so `pnpm test` doesn't fail on a fresh
 * checkout that hasn't run `pnpm run build:cli` yet).
 *
 * The pre-stage Phase 2 build step (and the future `prepare` hook,
 * implementation note) ensures the bundle is fresh whenever these tests run in
 * CI.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const BUNDLE_PATH = path.resolve(process.cwd(), 'dist/cli/lingua.cjs');
const BUNDLE_AVAILABLE = existsSync(BUNDLE_PATH);

function runCli(args: ReadonlyArray<string>, stdin?: string) {
  const result = spawnSync(process.execPath, [BUNDLE_PATH, ...args], {
    input: stdin,
    encoding: 'utf8',
    timeout: 10_000,
  });
  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

const describeIfBundle = BUNDLE_AVAILABLE ? describe : describe.skip;

describeIfBundle('CLI integration (dist/cli/lingua.cjs)', () => {
  it('exits 0 on --help', () => {
    const out = runCli(['--help']);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain('lingua — local code runner CLI');
  });

  it('exits 0 on --version + prints a non-empty version string', () => {
    const out = runCli(['--version']);
    expect(out.code).toBe(0);
    expect(out.stdout.trim().length).toBeGreaterThan(0);
    // The bundled version is replaced at build time from package.json.
    expect(out.stdout.trim()).not.toBe('0.0.0-dev');
  });

  it('runs utility json-format against stdin', () => {
    const out = runCli(['utility', 'json-format'], '{"a":1}');
    expect(out.code).toBe(0);
    expect(out.stdout).toContain('"a": 1');
    expect(out.stderr).toBe('');
  });

  it('exits 1 on unknown utility id with a helpful message', () => {
    const out = runCli(['utility', 'made-up-id'], 'unused');
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('Unknown utility id');
  });

  it('lists utilities as JSON', () => {
    const out = runCli(['list', 'utilities', '--json']);
    expect(out.code).toBe(0);
    const parsed = JSON.parse(out.stdout) as { utilities: unknown[] };
    // implementation — 23 adapters after the generator-style holdouts
    // (uuid / lorem-ipsum / string-inspect) landed. Runs against the
    // on-disk dist/cli bundle, so build:cli must run before this spec.
    expect(parsed.utilities).toHaveLength(23);
  });

  it('exits 1 with file-not-found when validating a missing capsule', () => {
    const out = runCli(['capsule', 'validate', '/definitely/not/here.json']);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('file-not-found');
  });
});

if (!BUNDLE_AVAILABLE) {
  // Surface a clear notice when the bundle is missing so the
  // operator knows why this block was skipped.
  console.warn(
    `[cli/integration] Skipping CLI integration tests — run "pnpm run build:cli" to produce ${BUNDLE_PATH}.`
  );
}
