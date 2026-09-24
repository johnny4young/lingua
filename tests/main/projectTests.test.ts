import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disposeProjectTestRuns,
  detectProjectTests,
  resetProjectNodeCacheForTests,
  runProjectTests,
  stopProjectTests,
} from '../../src/main/projectTests';
import { detectNode } from '../../src/main/node-runner';

vi.mock('../../src/main/node-runner', () => ({ detectNode: vi.fn() }));

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
  resetProjectNodeCacheForTests();
  vi.mocked(detectNode).mockResolvedValue({
    installed: true,
    binary: process.execPath,
    version: process.version,
  });
  rootPath = await mkdtemp(tmpPrefix);
  binPath = path.join(rootPath, '.trusted-bin');
  await mkdir(binPath);
});

afterEach(async () => {
  disposeProjectTestRuns();
  await rm(rootPath, { recursive: true, force: true });
});

describe('project test discovery', () => {
  it('reuses a resolved host Node across detections instead of re-probing', async () => {
    await write('package.json', JSON.stringify({ devDependencies: { vitest: '^4' } }));
    await write('node_modules/vitest/vitest.mjs');
    await detectProjectTests(rootPath);
    await detectProjectTests(rootPath);
    expect(detectNode).toHaveBeenCalledOnce();
  });

  it('probes again after a miss so a newly installed Node is found', async () => {
    await write('package.json', JSON.stringify({ devDependencies: { vitest: '^4' } }));
    await write('node_modules/vitest/vitest.mjs');
    vi.mocked(detectNode).mockResolvedValueOnce({ installed: false });
    const missing = await detectProjectTests(rootPath);
    expect(missing.candidates[0]).toMatchObject({ available: false, unavailableReason: 'node-not-found' });
    const found = await detectProjectTests(rootPath);
    expect(found.candidates[0]).toMatchObject({ available: true });
    expect(detectNode).toHaveBeenCalledTimes(2);
  });

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

  it('does not advertise JavaScript runners when host Node is missing', async () => {
    vi.mocked(detectNode).mockResolvedValue({ installed: false });
    await write('package.json', JSON.stringify({ devDependencies: { vitest: '*', jest: '*' } }));
    await write('node_modules/vitest/vitest.mjs');
    await write('node_modules/jest/bin/jest.js');
    const spawnImpl = vi.fn();
    const detection = await detectProjectTests(rootPath);
    expect(detection.candidates).toHaveLength(2);
    expect(
      detection.candidates.every(
        entry => !entry.available && entry.unavailableReason === 'node-not-found'
      )
    ).toBe(true);
    expect(await runProjectTests(rootPath, 'vitest', 'missing-node', { spawnImpl })).toMatchObject({
      kind: 'unavailable',
      unavailableReason: 'node-not-found',
    });
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('resolves a PATH-detected node absolutely and strips relative PATH entries', async () => {
    vi.mocked(detectNode).mockResolvedValue({
      installed: true,
      binary: 'node',
      version: process.version,
    });
    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
    await executable(nodeName);
    await write('package.json', JSON.stringify({ devDependencies: { jest: '*' } }));
    await write('node_modules/jest/bin/jest.js');
    const spawnImpl = vi.fn(async (_options: SpawnNativeRunOptions) => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      executionTime: 1,
      timedOut: false,
      killed: false,
    }));
    await runProjectTests(rootPath, 'jest', 'absolute-node', {
      env: {
        PATH: `.${path.delimiter}${binPath}${path.delimiter}relative`,
        SYNTHETIC_SECRET: 'must-not-reach-detector',
        NODE_OPTIONS: '--require injected.js',
        ELECTRON_RUN_AS_NODE: '1',
      },
      spawnImpl,
    });
    expect(detectNode).toHaveBeenLastCalledWith(
      { PATH: binPath },
      false,
      expect.any(AbortSignal)
    );
    expect(spawnImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        command: path.join(binPath, nodeName),
        args: [
          path.join(rootPath, 'node_modules/jest/bin/jest.js'),
          '--runInBand',
          '--colors=false',
        ],
      })
    );
    expect(spawnImpl.mock.calls[0]?.[0].env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
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

  it('owns Stop during framework detection and never spawns cancelled tests', async () => {
    let complete!: (value: Awaited<ReturnType<typeof detectNode>>) => void;
    vi.mocked(detectNode).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const spawnImpl = vi.fn(async () => ({
      stdout: '', stderr: '', exitCode: 0, executionTime: 0, timedOut: false, killed: false,
    }));
    const pending = runProjectTests(rootPath, 'vitest', 'preparing', { spawnImpl });
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    const stopped = stopProjectTests(rootPath, 'preparing');
    complete({ installed: true, binary: process.execPath, version: process.version });
    const result = await pending;
    expect(stopped).toBe(true);
    expect(result.kind).toBe('stopped');
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['same-id', 'invalid-request'], ['another-id', 'busy'],
  ])('reserves preparation against concurrent %s requests', async (secondId, expectedKind) => {
    let complete!: (value: Awaited<ReturnType<typeof detectNode>>) => void;
    vi.mocked(detectNode).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const spawnImpl = vi.fn(async () => ({
      stdout: '', stderr: '', exitCode: 0, executionTime: 0, timedOut: false, killed: false,
    }));
    const first = runProjectTests(rootPath, 'vitest', 'same-id', { spawnImpl });
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    const second = await runProjectTests(rootPath, 'vitest', secondId, { spawnImpl });
    complete({ installed: true, binary: process.execPath, version: process.version });
    await first;
    expect(second.kind).toBe(expectedKind);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });

  it('does not release a new owner when disposed preparation settles late', async () => {
    let complete!: (value: Awaited<ReturnType<typeof detectNode>>) => void;
    vi.mocked(detectNode).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const spawnOld = vi.fn(async () => ({
      stdout: '', stderr: '', exitCode: 0, executionTime: 0, timedOut: false, killed: false,
    }));
    const old = runProjectTests(rootPath, 'vitest', 'reused', { spawnImpl: spawnOld });
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    disposeProjectTestRuns();
    let started!: SpawnNativeRunOptions;
    let finish!: () => void;
    const current = runProjectTests(rootPath, 'vitest', 'reused', {
      spawnImpl: options => new Promise(resolve => {
        started = options;
        finish = () => resolve({
          stdout: '', stderr: '', exitCode: -1, executionTime: 0,
          timedOut: false, killed: options.signal?.aborted ?? false,
        });
      }),
    });
    await vi.waitFor(() => expect(started).toBeDefined());
    complete({ installed: true, binary: process.execPath, version: process.version });
    const oldResult = await old;
    const stopped = stopProjectTests(rootPath, 'reused');
    finish();
    const currentResult = await current;
    expect(oldResult.kind).toBe('stopped');
    expect(spawnOld).not.toHaveBeenCalled();
    expect(stopped).toBe(true);
    expect(currentResult.kind).toBe('stopped');
  });

  it('marks per-pipe clipping in the observed transcript and bounds live publication', async () => {
    const chunks: string[] = [];
    const result = await runProjectTests(rootPath, 'vitest', 'run-clipped-order', {
      onOutput: (_stream, chunk) => chunks.push(chunk),
      spawnImpl: async options => {
        options.onStdout?.('a'.repeat(256 * 1024 + 100));
        options.onStdout?.('MUST_NOT_APPEAR');
        options.onStderr?.('warning');
        return {
          stdout: '',
          stderr: 'warning',
          exitCode: 0,
          executionTime: 3,
          timedOut: false,
          killed: false,
        };
      },
    });
    expect(chunks.join('')).toContain('[project test output truncated]');
    expect(chunks.join('')).not.toContain('MUST_NOT_APPEAR');
    expect(chunks.join('').length).toBeLessThan(256 * 1024 + 100);
    expect(result).toMatchObject({ orderedOutput: chunks.join('') });
  });

  it('retains the observed stdout/stderr order in the final project-test result', async () => {
    const observed: string[] = [];
    const result = await runProjectTests(rootPath, 'vitest', 'run-observed-order', {
      onOutput: (_stream, chunk) => observed.push(chunk),
      spawnImpl: async options => {
        options.onStdout?.('first\n');
        options.onStderr?.('warning\n');
        options.onStdout?.('last\n');
        return {
          stdout: 'first\nlast\n',
          stderr: 'warning\n',
          exitCode: 0,
          executionTime: 3,
          timedOut: false,
          killed: false,
        };
      },
    });
    expect(observed).toEqual(['first\n', 'warning\n', 'last\n']);
    expect(result).toMatchObject({ orderedOutput: observed.join('') });
  });

  it('spawns a fixed argv in the approved project cwd without a shell', async () => {
    // Assigned inside the spawn callback; the cast stops TypeScript narrowing it to null.
    let captured = null as SpawnNativeRunOptions | null;
    const result = await runProjectTests(rootPath, 'vitest', 'run-1', {
      env: { PATH: binPath },
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
        command: process.execPath,
        args: [path.join(rootPath, 'node_modules/vitest/vitest.mjs'), 'run', '--no-color'],
        cwd: rootPath,
      })
    );
    expect(captured?.env).toEqual(
      expect.objectContaining({
        CI: '1',
        NO_COLOR: '1',
      })
    );
    expect(captured?.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
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
      `import ${JSON.stringify(pathToFileURL(installedVitestEntry).href)};\n`
    );
    await write('vitest.config.mjs', 'export default { test: { globals: true } };\n');
    await write(
      'test/example.test.js',
      "test('project runner fixture', () => { expect(2 + 2).toBe(4); });\n"
    );

    const result = await runProjectTests(rootPath, 'vitest', 'run-real-vitest');

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

    await expect(runProjectTests(rootPath, 'vitest', 'run-second')).resolves.toEqual(
      expect.objectContaining({ kind: 'busy' })
    );

    expect(stopProjectTests(rootPath, 'run-first')).toBe(true);
    await expect(firstRun).resolves.toEqual(expect.objectContaining({ kind: 'stopped' }));
  });

  it('reports a vanished Node executable as a runtime recovery error', async () => {
    const result = await runProjectTests(rootPath, 'vitest', 'run-spawn-error', {
      spawnImpl: async () => ({
        stdout: '',
        stderr: '',
        exitCode: -1,
        executionTime: 2,
        timedOut: false,
        killed: false,
        spawnError: new Error('node disappeared'),
      }),
    });

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'unavailable',
        unavailableReason: 'node-not-found',
      })
    );
  });

  it('forwards live stdout and stderr chunks from the bounded native runner', async () => {
    const output: string[] = [];
    const result = await runProjectTests(rootPath, 'vitest', 'run-stream', {
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
      ].join('\n')
    );
    const streamed: string[] = [];

    const result = await runProjectTests(rootPath, 'vitest', 'run-real-process', {
      platform: process.platform,
      env: process.env,
      onOutput: (_stream, chunk) => streamed.push(chunk),
    });

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'success',
        exitCode: 0,
        stdout: expect.stringContaining('fixture suite passed'),
      })
    );
    expect(streamed.join('')).toContain('fixture suite passed');
  });
});
