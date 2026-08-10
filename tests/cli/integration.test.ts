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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';

const BUNDLE_PATH = path.resolve(process.cwd(), 'dist/cli/lingua.cjs');
const BUNDLE_AVAILABLE = existsSync(BUNDLE_PATH);

function runCli(
  args: ReadonlyArray<string>,
  stdin?: string,
  environment: Readonly<Record<string, string | undefined>> = {}
) {
  const result = spawnSync(process.execPath, [BUNDLE_PATH, ...args], {
    input: stdin,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, ...environment },
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

  it('emits stable colored and JSON-safe parse failures', () => {
    const colored = runCli(['unknown', '--color=always']);
    expect(colored.code).toBe(1);
    expect(colored.stderr).toContain('\u001b[');
    expect(colored.stderr).toContain('error[invalid-arguments]');

    const structured = runCli(['unknown', '--color=always', '--json']);
    expect(structured.code).toBe(1);
    expect(structured.stderr).toBe('');
    expect(structured.stdout).not.toContain('\u001b[');
    expect(JSON.parse(structured.stdout)).toMatchObject({
      ok: false,
      reason: 'invalid-arguments',
    });
  });

  it('honors NO_COLOR in auto mode and explicit always overrides it', () => {
    const automatic = runCli(['unknown'], undefined, { NO_COLOR: '1' });
    expect(automatic.stderr).not.toContain('\u001b[');

    const forced = runCli(['unknown', '--color=always'], undefined, { NO_COLOR: '1' });
    expect(forced.stderr).toContain('\u001b[');
  });

  it('lists utilities as JSON', () => {
    const out = runCli(['list', 'utilities', '--json']);
    expect(out.code).toBe(0);
    const parsed = JSON.parse(out.stdout) as { utilities: unknown[] };
    // 24 adapters after cron-phrase joined the registry
    // (uuid / lorem-ipsum / string-inspect) landed. Runs against the
    // on-disk dist/cli bundle, so build:cli must run before this spec.
    expect(parsed.utilities).toHaveLength(24);
  });

  it.each(['bash', 'zsh', 'fish'] as const)('generates %s completion from the bundle', shell => {
    const out = runCli(['completion', shell, '--color=always']);
    expect(out.code).toBe(0);
    expect(out.stderr).toBe('');
    expect(out.stdout).toContain('lingua');
    expect(out.stdout).not.toContain('\u001b[');
  });

  it('exits 1 with file-not-found when validating a missing capsule', () => {
    const out = runCli(['capsule', 'validate', '/definitely/not/here.json']);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('file-not-found');
  });

  it('executes a JavaScript file and forwards arguments in the bundled CLI', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'lingua-cli-integration-'));
    try {
      const entry = path.join(root, 'hello.js');
      writeFileSync(entry, 'console.log(`hello ${process.argv[2]}`)\n', 'utf8');
      const out = runCli(['run', entry, '--json', '--', 'Lingua']);
      expect(out.code).toBe(0);
      expect(JSON.parse(out.stdout)).toMatchObject({
        ok: true,
        run: { runtime: 'node', stdout: 'hello Lingua\n' },
      });
      expect(out.stderr).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('executes a conventional project root in the bundled CLI', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'lingua-cli-project-'));
    try {
      writeFileSync(path.join(root, 'index.js'), 'console.log("project-root")\n', 'utf8');
      const out = runCli(['run', root]);
      expect(out.code).toBe(0);
      expect(out.stdout).toBe('project-root\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('replays a validated Capsule and reports comparison metadata', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'lingua-cli-capsule-'));
    try {
      const capsule = path.join(root, 'run.json');
      writeFileSync(capsule, JSON.stringify(FIXTURE_MINIMAL_JS), 'utf8');
      const out = runCli(['capsule', 'replay', capsule, '--json']);
      expect(out.code).toBe(0);
      expect(JSON.parse(out.stdout)).toMatchObject({
        ok: true,
        comparison: { matches: true },
        run: { stdout: '3\n' },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

if (!BUNDLE_AVAILABLE) {
  // Surface a clear notice when the bundle is missing so the
  // operator knows why this block was skipped.
  console.warn(
    `[cli/integration] Skipping CLI integration tests — run "pnpm run build:cli" to produce ${BUNDLE_PATH}.`
  );
}
