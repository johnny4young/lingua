import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, unknown>();
  const execFileAsync = vi.fn();
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: execFileAsync,
  });
  return {
    handlers,
    execFile,
    execFileAsync,
    spawn: vi.fn(),
    getPath: vi.fn(() => '/tmp/lingua-node-test'),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: mocks.getPath,
  },
  ipcMain: {
    handle: (channel: string, handler: unknown) => {
      mocks.handlers.set(channel, handler);
    },
  },
}));

vi.mock('node:child_process', () => ({
  default: {
    execFile: mocks.execFile,
    spawn: mocks.spawn,
  },
  execFile: mocks.execFile,
  spawn: mocks.spawn,
}));

type NodeRunHandler = (
  event: unknown,
  source: unknown,
  options?: unknown
) => Promise<NodeRunResult>;

type NodeStopHandler = (
  event: unknown,
  runId?: unknown
) => Promise<{ stopped: boolean }>;

function handlerFor<T>(channel: string): T {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing handler for ${channel}`);
  return handler as T;
}

function createChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: {
      // `on` mirrors the runtime contract: the runner attaches a stdin
      // 'error' listener (async EPIPE guard) before writing.
      on: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
    kill: ReturnType<typeof vi.fn>;
    pid?: number;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  };
  child.kill = vi.fn(() => true);
  return child;
}

describe('main node runner', () => {
  let tempRoot: string;
  let savedHome: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.execFile.mockReset();
    mocks.execFileAsync.mockReset();
    mocks.execFileAsync.mockResolvedValue({ stdout: 'v24.11.1\n', stderr: '' });
    mocks.spawn.mockReset();
    mocks.getPath.mockReturnValue('/tmp/lingua-node-test');
    savedHome = process.env.HOME;
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lingua-node-runner-'));
  });

  afterEach(async () => {
    if (savedHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = savedHome;
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('resolves cwd to the nearest node_modules ancestor for saved files', async () => {
    const project = path.join(tempRoot, 'project');
    const src = path.join(project, 'src', 'nested');
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await mkdir(src, { recursive: true });

    const { resolveNodeCwd } = await import('../../src/main/node-runner');

    expect(resolveNodeCwd(path.join(src, 'index.js'))).toBe(project);
  });

  it('falls back to Electron temp for unsaved Scratchpad runs', async () => {
    const { resolveNodeCwd } = await import('../../src/main/node-runner');

    expect(resolveNodeCwd()).toBe('/tmp/lingua-node-test');
  });

  it('registers run, detect, and stop IPC handlers', async () => {
    const { registerNodeJSHandlers } = await import('../../src/main/node-runner');
    registerNodeJSHandlers();

    expect(mocks.handlers.get('node:detect')).toBeTypeOf('function');
    expect(mocks.handlers.get('node:run')).toBeTypeOf('function');
    expect(mocks.handlers.get('node:stop')).toBeTypeOf('function');
  });

  it('rejects malformed IPC source without spawning a child', async () => {
    const { registerNodeJSHandlers } = await import('../../src/main/node-runner');
    registerNodeJSHandlers();

    const run = handlerFor<NodeRunHandler>('node:run');
    const result = await run({}, 42, {});

    expect(result.kind).toBe('error');
    expect(result.error).toMatch(/invalid source/i);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('threads filePath cwd, stdin, env, and runId through node:run', async () => {
    const project = path.join(tempRoot, 'project');
    const src = path.join(project, 'src');
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await mkdir(src, { recursive: true });
    await writeFile(path.join(project, 'package.json'), '{"type":"module"}', 'utf-8');
    const child = createChildProcess();
    mocks.spawn.mockReturnValue(child);

    const { registerNodeJSHandlers } = await import('../../src/main/node-runner');
    registerNodeJSHandlers();
    const run = handlerFor<NodeRunHandler>('node:run');
    const promise = run({}, 'console.log(process.cwd())', {
      runId: 'run-1',
      filePath: path.join(src, 'index.js'),
      timeoutMs: 5_000,
      userEnv: { NODE_PATH: '/custom/node_modules', BAD: 42 },
      stdin: 'hello\n',
    });

    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    child.stdout.emit('data', Buffer.from('ok\n'));
    child.emit('close', 0);

    await expect(promise).resolves.toMatchObject({
      kind: 'success',
      stdout: 'ok\n',
    });
    expect(mocks.spawn).toHaveBeenCalledWith(
      'node',
      ['--input-type=module', '-e', 'console.log(process.cwd())'],
      expect.objectContaining({
        cwd: project,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: expect.objectContaining({ NODE_PATH: '/custom/node_modules' }),
      })
    );
    expect(child.stdin.write).toHaveBeenCalledWith('hello\n');
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it('runs unsaved JavaScript import snippets as ESM without package config', async () => {
    const child = createChildProcess();
    mocks.spawn.mockReturnValue(child);

    const { registerNodeJSHandlers } = await import('../../src/main/node-runner');
    registerNodeJSHandlers();
    const run = handlerFor<NodeRunHandler>('node:run');
    const source =
      "import { randomInt } from 'crypto';\nconsole.log(randomInt(36 ** 6));";
    const promise = run({}, source, {});

    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    child.emit('close', 0);
    await expect(promise).resolves.toMatchObject({ kind: 'success' });

    expect(mocks.spawn).toHaveBeenCalledWith(
      'node',
      ['--input-type=module', '-e', source],
      expect.any(Object)
    );
  });

  it('runs top-level await snippets as ESM without package config', async () => {
    const child = createChildProcess();
    mocks.spawn.mockReturnValue(child);

    const { registerNodeJSHandlers } = await import('../../src/main/node-runner');
    registerNodeJSHandlers();
    const run = handlerFor<NodeRunHandler>('node:run');
    const source = 'console.log(await Promise.resolve(42));';
    const promise = run({}, source, {});

    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    child.emit('close', 0);
    await expect(promise).resolves.toMatchObject({ kind: 'success' });

    expect(mocks.spawn).toHaveBeenCalledWith(
      'node',
      ['--input-type=module', '-e', source],
      expect.any(Object)
    );
  });

  it('lets explicit CommonJS extensions override package ESM defaults', async () => {
    const project = path.join(tempRoot, 'project');
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, 'package.json'), '{"type":"module"}', 'utf-8');
    const child = createChildProcess();
    mocks.spawn.mockReturnValue(child);

    const { registerNodeJSHandlers } = await import('../../src/main/node-runner');
    registerNodeJSHandlers();
    const run = handlerFor<NodeRunHandler>('node:run');
    const promise = run({}, "const fs = require('node:fs'); console.log(Boolean(fs));", {
      filePath: path.join(project, 'index.cjs'),
    });

    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    child.emit('close', 0);
    await expect(promise).resolves.toMatchObject({ kind: 'success' });

    expect(mocks.spawn).toHaveBeenCalledWith(
      'node',
      [
        '--input-type=commonjs',
        '-e',
        "const fs = require('node:fs'); console.log(Boolean(fs));",
      ],
      expect.objectContaining({ cwd: project })
    );
  });

  it('falls back to a user-level fnm Node binary when GUI PATH cannot find node', async () => {
    process.env.HOME = tempRoot;
    const fallbackNode = path.join(
      tempRoot,
      '.local',
      'share',
      'fnm',
      'aliases',
      'default',
      'bin',
      'node'
    );
    await mkdir(path.dirname(fallbackNode), { recursive: true });
    await writeFile(fallbackNode, '');
    mocks.execFileAsync.mockImplementation(async (command: string) => {
      if (command === 'node') throw new Error('ENOENT');
      if (command === fallbackNode) {
        return { stdout: 'v24.15.0\n', stderr: '' };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const child = createChildProcess();
    mocks.spawn.mockReturnValue(child);

    const { detectNode, registerNodeJSHandlers } = await import(
      '../../src/main/node-runner'
    );

    await expect(detectNode(undefined, true)).resolves.toMatchObject({
      installed: true,
      binary: fallbackNode,
      version: 'v24.15.0',
    });

    registerNodeJSHandlers();
    const run = handlerFor<NodeRunHandler>('node:run');
    const promise = run({}, 'console.log(process.version)', {});

    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    child.emit('close', 0);
    await expect(promise).resolves.toMatchObject({ kind: 'success' });

    const spawnOptions = mocks.spawn.mock.calls[0]?.[2] as
      | { env?: NodeJS.ProcessEnv }
      | undefined;
    expect(mocks.spawn).toHaveBeenCalledWith(
      fallbackNode,
      ['--input-type=commonjs', '-e', 'console.log(process.version)'],
      expect.any(Object)
    );
    expect(spawnOptions?.env?.PATH?.split(path.delimiter)[0]).toBe(
      path.dirname(fallbackNode)
    );
  });

  it.runIf(process.platform !== 'win32')(
    'spawns a detached process-group leader on POSIX and group-kills the tree on stop',
    async () => {
      const child = createChildProcess();
      child.pid = 4242;
      mocks.spawn.mockReturnValue(child);
      const processKill = vi
        .spyOn(process, 'kill')
        .mockImplementation(() => true);

      try {
        const { registerNodeJSHandlers } = await import(
          '../../src/main/node-runner'
        );
        registerNodeJSHandlers();
        const run = handlerFor<NodeRunHandler>('node:run');
        const stop = handlerFor<NodeStopHandler>('node:stop');

        const promise = run({}, 'setInterval(() => {}, 1000)', {
          runId: 'run-tree',
          timeoutMs: 30_000,
        });
        await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));

        expect(mocks.spawn).toHaveBeenCalledWith(
          'node',
          expect.any(Array),
          expect.objectContaining({ detached: true })
        );

        await expect(stop({}, 'run-tree')).resolves.toEqual({ stopped: true });
        // The whole process group (-pid) gets the signal, not just the
        // direct child — user code that forked must die with it.
        expect(processKill).toHaveBeenCalledWith(-4242, 'SIGTERM');
        expect(child.kill).not.toHaveBeenCalled();

        child.emit('close', null);
        await expect(promise).resolves.toMatchObject({ kind: 'stopped' });
      } finally {
        processKill.mockRestore();
      }
    }
  );

  it('node:stop terminates the matching active child and resolves the run as stopped', async () => {
    const child = createChildProcess();
    mocks.spawn.mockReturnValue(child);

    const { registerNodeJSHandlers } = await import('../../src/main/node-runner');
    registerNodeJSHandlers();
    const run = handlerFor<NodeRunHandler>('node:run');
    const stop = handlerFor<NodeStopHandler>('node:stop');

    const promise = run({}, 'setInterval(() => {}, 1000)', {
      runId: 'run-stop',
      timeoutMs: 30_000,
    });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));

    await expect(stop({}, 'run-stop')).resolves.toEqual({ stopped: true });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    child.emit('close', null);
    await expect(promise).resolves.toMatchObject({
      kind: 'stopped',
      exitCode: -1,
    });
  });
});
