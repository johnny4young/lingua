import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { HOOKS_PATH, installGitHooks } from '../../scripts/install-git-hooks.mjs';
import { GATES, main, missingRequirements, selectGates } from '../../scripts/preflight.mjs';

const repoRoot = path.resolve(__dirname, '../..');

describe('preflight gates', () => {
  it('only runs commands that CI runs verbatim', () => {
    const ci = readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    for (const gate of GATES) {
      for (const step of gate.steps) {
        expect(ci, `${gate.name}: ${step.join(' ')}`).toContain(step.join(' '));
      }
    }
  });

  it('keeps build-backed gates out of the default set', () => {
    const fast = selectGates(GATES).map((gate) => gate.name);
    expect(fast).toContain('changelog');
    expect(fast).not.toContain('web-budget');
    expect(selectGates(GATES, { full: true }).map((gate) => gate.name)).toContain('web-budget');
    expect(selectGates(GATES, { only: ['lint'] }).map((gate) => gate.name)).toEqual(['lint']);
    expect(() => selectGates(GATES, { only: ['nope'] })).toThrow('Unknown gate(s): nope');
  });

  it('fails instead of passing when no gate can run', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'lingua-preflight-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const deadcode = GATES.find((gate) => gate.name === 'deadcode');
      expect(missingRequirements(deadcode, root)).toEqual(deadcode?.requires);
      expect(await main(['--only', 'deadcode'], { cwd: root })).toBe(1);
      expect(error).toHaveBeenCalledWith('preflight: no gate could run.');
    } finally {
      log.mockRestore();
      error.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('pre-push hook', () => {
  it('runs preflight from the versioned hooks directory', () => {
    const hook = path.join(repoRoot, HOOKS_PATH, 'pre-push');
    expect(readFileSync(hook, 'utf8')).toContain('exec node scripts/preflight.mjs');
    if (process.platform !== 'win32') {
      expect(statSync(hook).mode & 0o111).not.toBe(0);
    }
  });

  it('installs the hooks path without overriding CI or a custom path', () => {
    const calls: string[][] = [];
    const fakeGit = (hooksPath: string) => (args: string[]) => {
      calls.push(args);
      if (args[0] === 'rev-parse') return 'true';
      if (args[1] === '--get') {
        if (!hooksPath) throw new Error('unset');
        return hooksPath;
      }
      return '';
    };

    expect(installGitHooks({ env: { CI: 'true' }, run: fakeGit('') })).toBe('skipped: CI');
    expect(installGitHooks({ env: {}, run: fakeGit('.husky') })).toBe(
      'skipped: core.hooksPath is .husky'
    );
    expect(installGitHooks({ env: {}, run: fakeGit(HOOKS_PATH) })).toBe('already installed');
    calls.length = 0;
    expect(installGitHooks({ env: {}, run: fakeGit('') })).toBe('installed');
    expect(calls).toContainEqual(['config', 'core.hooksPath', HOOKS_PATH]);
  });
});
