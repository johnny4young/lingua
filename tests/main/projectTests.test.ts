import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disposeProjectTestRuns,
  detectProjectTests,
  runProjectTests,
  stopProjectTests,
} from '../../src/main/projectTests';
import type { SpawnNativeRunOptions } from '../../src/main/runners/spawnNativeRun';

const tmpPrefix = path.join(process.cwd(), '.tmp-lingua-project-tests-');
let rootPath: string;
let binPath: string;

async function write(relativePath: string, contents = ''): Promise<void> {
  const absolutePath = path.join(rootPath, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, 'utf8');
}

async function executable(name: string): Promise<void> {
  const absolutePath = path.join(binPath, name);
  await writeFile(absolutePath, '#!/bin/sh\nexit 0\n', 'utf8');
  await chmod(absolutePath, 0o755);
}

beforeEach(async () => {
  rootPath = await mkdtemp(tmpPrefix);
  binPath = path.join(rootPath, '.trusted-bin');
  await mkdir(binPath);
});

afterEach(async () => {
  disposeProjectTestRuns();
  await rm(rootPath, { recursive: true, force: true });
});

describe('project test discovery', () => {
  it('detects every supported root marker in deterministic order', async () => {
    await write(
      'package.json',
      JSON.stringify({
        scripts: { test: 'vitest run', legacy: 'jest' },
        devDependencies: { vitest: '^4', jest: '^30' },
      })
    );
    await write('vitest.config.ts', 'export default {};');
    await write('jest.config.js', 'module.exports = {};');
    await write('node_modules/vitest/vitest.mjs');
    await write('node_modules/jest/bin/jest.js');
    await write('pyproject.toml', '[tool.pytest.ini_options]\n');
    await write('go.mod', 'module example.test/project\n');
    await write('Cargo.toml', '[package]\nname = "example"\nversion = "0.1.0"\n');
    await executable('python3');
    await executable('go');
    await executable('cargo');

    const result = await detectProjectTests(rootPath, {
      platform: 'linux',
      env: { PATH: binPath },
      electronExecutable: '/trusted/electron',
    });

    expect(result.kind).toBe('ready');
    expect(result.candidates.map(entry => entry.framework)).toEqual([
      'vitest',
      'jest',
      'pytest',
      'go',
      'cargo',
    ]);
    expect(result.candidates.every(entry => entry.available)).toBe(true);
    expect(result.candidates[0]?.evidence).toEqual([
      'vitest.config.ts',
      'package.json#vitest',
      'package.json#scripts',
    ]);
  });

  it('reports detected frameworks separately from missing dependencies and tools', async () => {
    await write('package.json', JSON.stringify({ devDependencies: { vitest: '^4' } }));
    await write('pytest.ini', '[pytest]\n');

    const result = await detectProjectTests(rootPath, {
      platform: 'linux',
      env: { PATH: '' },
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        framework: 'vitest',
        available: false,
        unavailableReason: 'dependencies-not-installed',
      }),
      expect.objectContaining({
        framework: 'pytest',
        available: false,
        unavailableReason: 'toolchain-not-found',
      }),
    ]);
  });

  it('does not resolve planted toolchains through relative PATH entries', async () => {
    await write('go.mod', 'module example.test/project\n');
    await executable('go');

    const result = await detectProjectTests(rootPath, {
      platform: 'linux',
      env: { PATH: `.${path.delimiter}${path.relative(rootPath, binPath)}` },
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        framework: 'go',
        available: false,
        unavailableReason: 'toolchain-not-found',
      }),
    ]);
  });

  it('returns none when no supported project marker exists', async () => {
    expect(await detectProjectTests(rootPath, { env: { PATH: '' } })).toEqual({
      kind: 'none',
      candidates: [],
    });
  });

  it('detects a conventional Pytest file without requiring configuration', async () => {
    await write('tests/test_checkout.py', 'def test_checkout():\n    assert True\n');
    await executable('python3');

    const result = await detectProjectTests(rootPath, {
      platform: 'linux',
      env: { PATH: binPath },
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        framework: 'pytest',
        available: true,
        evidence: ['tests/test_checkout.py'],
      }),
    ]);
  });
});

describe('project test execution', () => {
  beforeEach(async () => {
    await write('package.json', JSON.stringify({ devDependencies: { vitest: '^4' } }));
    await write('node_modules/vitest/vitest.mjs');
  });

  it('spawns a fixed argv in the approved project cwd without a shell', async () => {
    let captured: SpawnNativeRunOptions | null = null;
    const result = await runProjectTests(rootPath, 'vitest', 'run-1', {
      platform: 'linux',
      env: { PATH: binPath },
      electronExecutable: '/trusted/electron',
      spawnImpl: async options => {
        captured = options;
        return {
          stdout: '2 tests passed\n',
          stderr: '',
          exitCode: 0,
          executionTime: 42,
          timedOut: false,
          killed: false,
        };
      },
    });

    expect(captured).toEqual(
      expect.objectContaining({
        command: '/trusted/electron',
        args: [path.join(rootPath, 'node_modules/vitest/vitest.mjs'), 'run', '--no-color'],
        cwd: rootPath,
      })
    );
    expect(captured?.env).toEqual(
      expect.objectContaining({
        CI: '1',
        ELECTRON_RUN_AS_NODE: '1',
        NO_COLOR: '1',
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        kind: 'success',
        framework: 'vitest',
        command: 'vitest run --no-color',
        stdout: '2 tests passed\n',
        exitCode: 0,
      })
    );
  });

  it('executes a real detected Vitest suite through the fixed local entrypoint', async () => {
    const installedVitestEntry = path.resolve('node_modules/vitest/vitest.mjs');
    await write(
      'node_modules/vitest/vitest.mjs',
      `import ${JSON.stringify(pathToFileURL(installedVitestEntry).href)};\n`,
    );
    await write('vitest.config.mjs', 'export default { test: { globals: true } };\n');
    await write(
      'test/example.test.js',
      "test('project runner fixture', () => { expect(2 + 2).toBe(4); });\n",
    );

    const result = await runProjectTests(rootPath, 'vitest', 'run-real-vitest', {
      electronExecutable: process.execPath,
    });

    expect(result.kind).toBe('success');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('1 passed');
  });

  it('re-detects the requested framework and rejects unsupported input', async () => {
    expect(await runProjectTests(rootPath, 'cargo', 'run-2')).toEqual(
      expect.objectContaining({ kind: 'not-detected', framework: 'cargo' })
    );
    expect(await runProjectTests(rootPath, 'vitest; rm -rf /', 'run-3')).toEqual(
      expect.objectContaining({ kind: 'invalid-request', framework: null })
    );
    expect(await runProjectTests(rootPath, 'vitest', '../bad')).toEqual(
      expect.objectContaining({ kind: 'invalid-request', framework: null })
    );
  });

  it('stops only the matching project run', async () => {
    let started!: () => void;
    const didStart = new Promise<void>(resolve => {
      started = resolve;
    });
    const run = runProjectTests(rootPath, 'vitest', 'run-stop', {
      platform: 'linux',
      electronExecutable: '/trusted/electron',
      spawnImpl: options =>
        new Promise(resolve => {
          started();
          options.signal?.addEventListener(
            'abort',
            () => {
              resolve({
                stdout: '',
                stderr: '',
                exitCode: -1,
                executionTime: 5,
                timedOut: false,
                killed: true,
              });
            },
            { once: true }
          );
        }),
    });
    await didStart;

    expect(stopProjectTests(path.join(rootPath, 'other'), 'run-stop')).toBe(false);
    expect(stopProjectTests(rootPath, 'run-stop')).toBe(true);
    await expect(run).resolves.toEqual(expect.objectContaining({ kind: 'stopped' }));
  });

  it('does not spawn after the renderer lifecycle has already ended', async () => {
    const ownerLifecycle = new AbortController();
    ownerLifecycle.abort();
    const spawnImpl = vi.fn();

    const result = await runProjectTests(rootPath, 'vitest', 'run-owner-gone', {
      platform: 'linux',
      electronExecutable: '/trusted/electron',
      signal: ownerLifecycle.signal,
      spawnImpl,
    });

    expect(result).toEqual(expect.objectContaining({ kind: 'stopped' }));
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('allows only one active test run per approved project root', async () => {
    let started!: () => void;
    const didStart = new Promise<void>(resolve => {
      started = resolve;
    });
    const firstRun = runProjectTests(rootPath, 'vitest', 'run-first', {
      platform: 'linux',
      electronExecutable: '/trusted/electron',
      spawnImpl: options =>
        new Promise(resolve => {
          started();
          options.signal?.addEventListener(
            'abort',
            () =>
              resolve({
                stdout: '',
                stderr: '',
                exitCode: -1,
                executionTime: 5,
                timedOut: false,
                killed: true,
              }),
            { once: true }
          );
        }),
    });
    await didStart;

    await expect(
      runProjectTests(rootPath, 'vitest', 'run-second', {
        platform: 'linux',
        electronExecutable: '/trusted/electron',
      })
    ).resolves.toEqual(expect.objectContaining({ kind: 'busy' }));

    expect(stopProjectTests(rootPath, 'run-first')).toBe(true);
    await expect(firstRun).resolves.toEqual(expect.objectContaining({ kind: 'stopped' }));
  });

  it('reports JavaScript runner spawn failures as missing local dependencies', async () => {
    const result = await runProjectTests(rootPath, 'vitest', 'run-spawn-error', {
      platform: 'linux',
      electronExecutable: '/trusted/electron',
      spawnImpl: async () => ({
        stdout: '',
        stderr: '',
        exitCode: -1,
        executionTime: 2,
        timedOut: false,
        killed: false,
        spawnError: new Error('entry disappeared'),
      }),
    });

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'unavailable',
        unavailableReason: 'dependencies-not-installed',
      })
    );
  });

  it('forwards live stdout and stderr chunks from the bounded native runner', async () => {
    const output: string[] = [];
    const result = await runProjectTests(rootPath, 'vitest', 'run-stream', {
      platform: 'linux',
      electronExecutable: '/trusted/electron',
      onOutput: (stream, chunk) => output.push(`${stream}:${chunk}`),
      spawnImpl: async options => {
        options.onStdout?.('collecting tests\n');
        options.onStderr?.('warning\n');
        return {
          stdout: 'collecting tests\n',
          stderr: 'warning\n',
          exitCode: 0,
          executionTime: 8,
          timedOut: false,
          killed: false,
        };
      },
    });

    expect(result.kind).toBe('success');
    expect(output).toEqual(['stdout:collecting tests\n', 'stderr:warning\n']);
  });

  it('executes the local Vitest entry through the real no-shell process path', async () => {
    await write(
      'node_modules/vitest/vitest.mjs',
      [
        "if (process.argv.slice(2).join(' ') !== 'run --no-color') process.exit(2);",
        "console.log('fixture suite passed');",
      ].join('\n'),
    );
    const streamed: string[] = [];

    const result = await runProjectTests(rootPath, 'vitest', 'run-real-process', {
      platform: process.platform,
      env: process.env,
      electronExecutable: process.execPath,
      onOutput: (_stream, chunk) => streamed.push(chunk),
    });

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'success',
        exitCode: 0,
        stdout: expect.stringContaining('fixture suite passed'),
      }),
    );
    expect(streamed.join('')).toContain('fixture suite passed');
  });
});
