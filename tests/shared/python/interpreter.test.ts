/**
 * The shared Python interpreter discovery policy.
 *
 * Three surfaces spawn Python — the CLI, the project test runner and the
 * debugger — and each used to carry its own candidate list. On Windows they
 * genuinely disagreed, so the same project could resolve to three different
 * interpreters. These cases pin the single policy that replaced them.
 *
 * Everything here runs the full platform matrix on any host: the module takes
 * `platform` for both the path flavour and the command list, and never touches
 * the filesystem or spawns anything, so win32 paths are exercised from macOS
 * and Linux CI alike. The Windows job in ci.yml also runs this file natively.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  pythonCommandCandidates,
  pythonInterpreterCandidates,
  pythonVenvRelativePaths,
  resolvePythonInterpreter,
  type PythonCandidate,
} from '../../../src/shared/python/interpreter';

function commandsFrom(candidates: ReadonlyArray<PythonCandidate>): string[] {
  return candidates.map(candidate => candidate.command);
}

describe('pythonCommandCandidates', () => {
  it('leads with the py launcher family on Windows', () => {
    expect(pythonCommandCandidates('win32')).toEqual(['python', 'py', 'python3']);
  });

  it('prefers python3 elsewhere, since python may still be Python 2', () => {
    expect(pythonCommandCandidates('darwin')).toEqual(['python3', 'python']);
    expect(pythonCommandCandidates('linux')).toEqual(['python3', 'python']);
  });
});

describe('pythonVenvRelativePaths', () => {
  it('uses the Scripts layout with an .exe suffix on Windows', () => {
    expect(pythonVenvRelativePaths('win32')).toEqual([
      '.venv\\Scripts\\python.exe',
      'venv\\Scripts\\python.exe',
    ]);
  });

  it('uses the bin layout elsewhere', () => {
    expect(pythonVenvRelativePaths('linux')).toEqual(['.venv/bin/python', 'venv/bin/python']);
  });

  it('prefers a dotted virtualenv over a bare one', () => {
    const [first] = pythonVenvRelativePaths('darwin');
    expect(first).toContain('.venv');
  });
});

describe('pythonInterpreterCandidates', () => {
  it('tries project virtualenvs before anything on PATH', () => {
    const candidates = pythonInterpreterCandidates({
      startDirectory: '/repo',
      platform: 'linux',
    });

    expect(commandsFrom(candidates)).toEqual([
      '/repo/.venv/bin/python',
      '/repo/venv/bin/python',
      'python3',
      'python',
    ]);
  });

  it('builds Windows candidates from a Windows root on any host', () => {
    const candidates = pythonInterpreterCandidates({
      startDirectory: 'C:\\repo',
      platform: 'win32',
    });

    expect(commandsFrom(candidates)).toEqual([
      'C:\\repo\\.venv\\Scripts\\python.exe',
      'C:\\repo\\venv\\Scripts\\python.exe',
      'python',
      'py',
      'python3',
    ]);
  });

  it('does not leave the start directory unless asked to walk up', () => {
    const candidates = pythonInterpreterCandidates({
      startDirectory: '/repo/packages/app',
      platform: 'linux',
    });

    expect(commandsFrom(candidates).filter(command => command.includes('venv'))).toEqual([
      '/repo/packages/app/.venv/bin/python',
      '/repo/packages/app/venv/bin/python',
    ]);
  });

  it('walks toward the root when asked, nearest ancestor first', () => {
    const candidates = pythonInterpreterCandidates({
      startDirectory: '/repo/packages/app',
      platform: 'linux',
      walkUp: true,
    });

    expect(commandsFrom(candidates).filter(command => command.includes('venv'))).toEqual([
      '/repo/packages/app/.venv/bin/python',
      '/repo/packages/app/venv/bin/python',
      '/repo/packages/.venv/bin/python',
      '/repo/packages/venv/bin/python',
      '/repo/.venv/bin/python',
      '/repo/venv/bin/python',
      '/.venv/bin/python',
      '/venv/bin/python',
    ]);
  });

  it('terminates the walk at a Windows drive root', () => {
    const candidates = pythonInterpreterCandidates({
      startDirectory: 'C:\\repo\\app',
      platform: 'win32',
      walkUp: true,
    });

    expect(commandsFrom(candidates).filter(command => command.includes('venv'))).toEqual([
      'C:\\repo\\app\\.venv\\Scripts\\python.exe',
      'C:\\repo\\app\\venv\\Scripts\\python.exe',
      'C:\\repo\\.venv\\Scripts\\python.exe',
      'C:\\repo\\venv\\Scripts\\python.exe',
      'C:\\.venv\\Scripts\\python.exe',
      'C:\\venv\\Scripts\\python.exe',
    ]);
  });

  it('terminates the walk on a relative start directory', () => {
    const candidates = pythonInterpreterCandidates({
      startDirectory: 'app',
      platform: 'linux',
      walkUp: true,
    });

    expect(commandsFrom(candidates).filter(command => command.includes('venv'))).toEqual([
      'app/.venv/bin/python',
      'app/venv/bin/python',
      '.venv/bin/python',
      'venv/bin/python',
    ]);
  });

  it('places an explicit PYTHON override after virtualenvs and before PATH', () => {
    const candidates = pythonInterpreterCandidates({
      startDirectory: '/repo',
      platform: 'linux',
      env: { PYTHON: '/opt/python/bin/python' },
      respectPythonEnv: true,
    });

    expect(commandsFrom(candidates)).toEqual([
      '/repo/.venv/bin/python',
      '/repo/venv/bin/python',
      '/opt/python/bin/python',
      'python3',
      'python',
    ]);
    expect(candidates[2]?.source).toBe('python-env');
  });

  it('ignores PYTHON unless the surface opts in', () => {
    const candidates = pythonInterpreterCandidates({
      startDirectory: '/repo',
      platform: 'linux',
      env: { PYTHON: '/opt/python/bin/python' },
    });

    expect(commandsFrom(candidates)).not.toContain('/opt/python/bin/python');
  });

  it('ignores an empty PYTHON even when the surface opts in', () => {
    const candidates = pythonInterpreterCandidates({
      startDirectory: '/repo',
      platform: 'linux',
      env: { PYTHON: '' },
      respectPythonEnv: true,
    });

    expect(candidates.some(candidate => candidate.source === 'python-env')).toBe(false);
  });

  it('tolerates a missing environment', () => {
    const candidates = pythonInterpreterCandidates({
      startDirectory: '/repo',
      platform: 'linux',
      respectPythonEnv: true,
    });

    expect(candidates.some(candidate => candidate.source === 'python-env')).toBe(false);
  });

  it('labels every candidate with where it came from', () => {
    const candidates = pythonInterpreterCandidates({
      startDirectory: '/repo',
      platform: 'linux',
      env: { PYTHON: '/opt/py' },
      respectPythonEnv: true,
    });

    expect(candidates.map(candidate => candidate.source)).toEqual([
      'venv',
      'venv',
      'python-env',
      'path',
      'path',
    ]);
  });
});

describe('resolvePythonInterpreter', () => {
  it('returns what the probe accepts, not the candidate itself', async () => {
    const resolved = await resolvePythonInterpreter(
      { startDirectory: '/repo', platform: 'linux' },
      async candidate => (candidate.source === 'path' ? `/usr/bin/${candidate.command}` : null)
    );

    expect(resolved).toBe('/usr/bin/python3');
  });

  it('stops at the first accepted candidate', async () => {
    const probe = vi.fn(async (candidate: PythonCandidate) =>
      candidate.command === '/repo/.venv/bin/python' ? candidate.command : null
    );

    const resolved = await resolvePythonInterpreter(
      { startDirectory: '/repo', platform: 'linux' },
      probe
    );

    expect(resolved).toBe('/repo/.venv/bin/python');
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('falls through a rejected candidate to the next one', async () => {
    const resolved = await resolvePythonInterpreter(
      { startDirectory: '/repo', platform: 'linux' },
      async candidate => (candidate.command === '/repo/venv/bin/python' ? candidate.command : null)
    );

    expect(resolved).toBe('/repo/venv/bin/python');
  });

  it('returns null when every candidate is rejected, leaving the fallback to the caller', async () => {
    const resolved = await resolvePythonInterpreter(
      { startDirectory: '/repo', platform: 'linux' },
      async () => null
    );

    expect(resolved).toBeNull();
  });

  it('probes candidates in policy order', async () => {
    const seen: string[] = [];

    await resolvePythonInterpreter(
      { startDirectory: 'C:\\repo', platform: 'win32' },
      async candidate => {
        seen.push(candidate.command);
        return null;
      }
    );

    expect(seen).toEqual([
      'C:\\repo\\.venv\\Scripts\\python.exe',
      'C:\\repo\\venv\\Scripts\\python.exe',
      'python',
      'py',
      'python3',
    ]);
  });
});
