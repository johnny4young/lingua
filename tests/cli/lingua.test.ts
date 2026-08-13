/**
 * implementation — dispatcher tests.
 *
 * Drives the top-level `dispatch()` directly. Validates argv → exit
 * code mapping for the cross-cutting flows (help, version, parse
 * errors, internal errors).
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CLI_EXIT_CODES } from '../../src/cli/exit-codes';
import { dispatch } from '../../src/cli/lingua';
import { FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';
import { createFakeIo } from './io-fake';

describe('dispatch', () => {
  it('prints help on no args', async () => {
    const { io, state } = createFakeIo();
    const code = await dispatch([], io);
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stdout).toContain('lingua — local code runner CLI');
    expect(state.stdout).toContain('Exit codes:');
  });

  it('prints help on --help', async () => {
    const { io, state } = createFakeIo();
    const code = await dispatch(['--help'], io);
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stdout).toContain('Usage:');
  });

  it('prints version on --version', async () => {
    const { io, state } = createFakeIo();
    const code = await dispatch(['--version'], io);
    expect(code).toBe(CLI_EXIT_CODES.ok);
    // The version placeholder is replaced at bundle time; in tests
    // the fallback "0.0.0-dev" sentinel is emitted.
    expect(state.stdout.trim().length).toBeGreaterThan(0);
  });

  it('maps argv parse errors to user input error', async () => {
    const { io, state } = createFakeIo();
    const code = await dispatch(['bogus-command'], io);
    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    expect(state.stderr).toContain('lingua:');
    expect(state.stderr).toContain('error[invalid-arguments]');
    expect(state.stderr).toContain('Unknown command');
  });

  it('keeps parse failures machine-readable when --json is present', async () => {
    const { io, state } = createFakeIo();
    const code = await dispatch(['bogus-command', '--json'], io);
    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    expect(state.stderr).toBe('');
    expect(JSON.parse(state.stdout)).toEqual({
      ok: false,
      reason: 'invalid-arguments',
      detail: 'Unknown command "bogus-command". Run "lingua --help" for usage.',
    });
  });

  it('colors help only when explicitly requested', async () => {
    const forced = createFakeIo();
    await dispatch(['--color=always', '--help'], forced.io);
    expect(forced.state.stdout).toContain('\u001b[');

    const disabled = createFakeIo({ stdoutSupportsColor: true });
    await dispatch(['--color=never', '--help'], disabled.io);
    expect(disabled.state.stdout).not.toContain('\u001b[');
  });

  it('routes utility command through to the handler', async () => {
    const { io, state } = createFakeIo({ stdin: '{"a":1}' });
    const code = await dispatch(['utility', 'json-format'], io);
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stdout).toContain('"a": 1');
  });

  it('routes capsule validate through to the handler', async () => {
    const enoent = new Error('ENOENT') as NodeJS.ErrnoException;
    enoent.code = 'ENOENT';
    const { io } = createFakeIo({ readFileError: enoent });
    const code = await dispatch(['capsule', 'validate', '/missing'], io);
    expect(code).toBe(CLI_EXIT_CODES.userInputError);
  });

  it('routes list utilities through to the handler', async () => {
    const { io, state } = createFakeIo();
    const code = await dispatch(['list', 'utilities', '--json'], io);
    expect(code).toBe(CLI_EXIT_CODES.ok);
    const parsed = JSON.parse(state.stdout) as { utilities: unknown[] };
    // 24 adapters after cron-phrase joined the registry
    // (uuid / lorem-ipsum / string-inspect) landed.
    expect(parsed.utilities).toHaveLength(24);
  });

  it.each(['bash', 'zsh', 'fish'] as const)('renders %s completion without ANSI', async shell => {
    const { io, state } = createFakeIo({ stdoutSupportsColor: true });
    const code = await dispatch(['completion', shell, '--color=always'], io);
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stdout).toContain('lingua');
    expect(state.stdout).not.toContain('\u001b[');
  });

  it('routes a bare completion command to a safe detected-shell dry run', async () => {
    const { io, state } = createFakeIo({
      environment: { HOME: '/tmp', SHELL: '/bin/zsh', PATH: '/bin:/usr/bin' },
    });
    const code = await dispatch(['completion', '--dry-run'], io);
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stdout).toContain('Lingua detected these supported shells:');
    expect(state.stdout).toContain('Dry run: no files were changed.');
    expect(state.prompts).toEqual([]);
  });

  it('routes run through the headless executor', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-dispatch-run-'));
    try {
      const entry = path.join(root, 'hello.js');
      await writeFile(entry, 'console.log("dispatch-run")\n', 'utf8');
      const { io, state } = createFakeIo();
      const code = await dispatch(['run', entry, '--json'], io);
      expect(code).toBe(CLI_EXIT_CODES.ok);
      expect(JSON.parse(state.stdout)).toMatchObject({
        ok: true,
        run: { stdout: 'dispatch-run\n' },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('routes capsule replay through shared validation and execution', async () => {
    const { io, state } = createFakeIo({
      files: { '/tmp/run.json': JSON.stringify(FIXTURE_MINIMAL_JS) },
    });
    const code = await dispatch(['capsule', 'replay', '/tmp/run.json', '--json'], io);
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(JSON.parse(state.stdout)).toMatchObject({
      ok: true,
      comparison: { matches: true },
      run: { stdout: '3\n' },
    });
  });
});
