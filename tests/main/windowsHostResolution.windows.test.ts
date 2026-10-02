// Runs only on a real Windows host (the CI Windows job); mocks elsewhere cover the logic.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveHostExecutable, resolveWindowsLaunch } from '../../src/main/runners/hostExecutable';
import { buildNativeRunnerEnv, combinedAllowlist } from '../../src/main/runners/nativeEnv';
import { toWatchRelativeName } from '../../src/main/ipc/fs/fsWatchers';
import { npmScriptCommand } from '../../src/cli/runtime/targets';

describe.skipIf(process.platform !== 'win32')('Windows host resolution on a real runner', () => {
  const env = buildNativeRunnerEnv(combinedAllowlist([]), undefined);

  it('keeps PATH and COMSPEC through the native env allowlist', () => {
    expect(env.PATH ?? '').toContain(';');
    expect(path.isAbsolute(env.COMSPEC ?? env.ComSpec ?? '')).toBe(true);
  });

  it('resolves node.exe from an absolute PATH entry, also from a copied env', async () => {
    const fromAllowlist = await resolveHostExecutable(['node.exe'], env, 'win32');
    const fromCopy = await resolveHostExecutable(['node.exe'], { ...process.env }, 'win32');
    expect(fromAllowlist && path.isAbsolute(fromAllowlist)).toBe(true);
    expect(fromCopy?.toLowerCase()).toBe(fromAllowlist?.toLowerCase());
  });

  it('never picks a binary planted behind a relative PATH entry', async () => {
    const planted = await mkdtemp(path.join(process.cwd(), '.tmp-lingua-plant-'));
    try {
      await writeFile(path.join(planted, 'node.exe'), '');
      const relative = path.relative(process.cwd(), planted);
      const resolved = await resolveHostExecutable(
        ['node.exe'],
        { ...env, PATH: `${relative};${env.PATH ?? ''}` },
        'win32'
      );
      expect(resolved).not.toBeNull();
      expect(path.dirname(resolved!).toLowerCase()).not.toBe(planted.toLowerCase());
    } finally {
      await rm(planted, { recursive: true, force: true });
    }
  });

  it('launches the npm shim through COMSPEC with an absolute npm.cmd', async () => {
    const launch = await resolveWindowsLaunch('npm', ['--version'], env);
    expect(launch).not.toBeNull();
    expect(launch!.command.toLowerCase()).toBe((env.COMSPEC ?? '').toLowerCase());
    expect(launch!.args.slice(0, 2)).toEqual(['/d', '/c']);
    expect(path.isAbsolute(launch!.args[2]!)).toBe(true);
  });

  it('builds a verbatim npm script command for the CLI', async () => {
    const step = await npmScriptCommand('test', ['a b', 'x&y'], process.env);
    expect(path.isAbsolute(step.command)).toBe(true);
    expect(step.windowsVerbatimArguments).toBe(true);
    expect(step.args.at(-1)).toMatch(/npm\.cmd/iu);
  });

  it('normalizes watcher names to forward slashes', () => {
    expect(toWatchRelativeName(`src${path.sep}app.ts`)).toBe('src/app.ts');
  });
});

it.skipIf(process.platform === 'win32')('is a Windows-only suite', () => {
  expect(os.platform()).not.toBe('win32');
});
