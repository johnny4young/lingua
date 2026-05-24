/**
 * RL-025 Slice B — IPC handler registration + log streaming.
 *
 * Pins:
 *   - `dependencies:js:install` and `dependencies:js:install:cancel`
 *     channels register.
 *   - The install handler forwards onLog payloads via
 *     `event.sender.send('dependencies:js:install:log', …)`.
 *   - Malformed payloads short-circuit with a deterministic failure
 *     shape (no spawn, no log).
 */

import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    getPath: vi.fn(() => '/tmp/lingua-ipc-test'),
    spawn: vi.fn(),
    execFile,
    execFileAsync,
  };
});

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
  ipcMain: {
    handle: (channel: string, handler: unknown) => {
      mocks.handlers.set(channel, handler);
    },
  },
}));

vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
  execFile: mocks.execFile,
  default: { spawn: mocks.spawn, execFile: mocks.execFile },
}));

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function createChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function makeSender() {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
  };
}

describe('dependencies IPC — install lifecycle', () => {
  let workdir = '';

  beforeEach(async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.spawn.mockReset();
    workdir = await mkdtemp(path.join(os.tmpdir(), 'lingua-ipc-install-'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
    const { __resetActiveInstallsForTests } = await import(
      '../../../src/main/dependencies'
    );
    __resetActiveInstallsForTests();
  });

  it('registers install + cancel channels', async () => {
    const { registerDependencyHandlers } = await import(
      '../../../src/main/ipc/dependencies'
    );
    registerDependencyHandlers();
    expect(mocks.handlers.get('dependencies:js:resolve')).toBeTypeOf(
      'function'
    );
    expect(mocks.handlers.get('dependencies:js:install')).toBeTypeOf(
      'function'
    );
    expect(mocks.handlers.get('dependencies:js:install:cancel')).toBeTypeOf(
      'function'
    );
  });

  it('forwards log chunks to event.sender on the streaming channel', async () => {
    await writeFile(path.join(workdir, 'package.json'), '{}');
    const child = createChild();
    mocks.spawn.mockReturnValue(child);
    const { registerDependencyHandlers, INSTALL_LOG_CHANNEL } = await import(
      '../../../src/main/ipc/dependencies'
    );
    registerDependencyHandlers();
    const handler = mocks.handlers.get('dependencies:js:install') as (
      event: { sender: ReturnType<typeof makeSender> },
      ...rest: unknown[]
    ) => Promise<unknown>;
    const sender = makeSender();
    const promise = handler(
      { sender },
      'run-1',
      ['lodash'],
      path.join(workdir, 'app.js')
    );
    await Promise.resolve();
    child.stdout.emit('data', Buffer.from('added 1\n'));
    child.emit('close', 0);
    await promise;
    expect(sender.send).toHaveBeenCalledWith(
      INSTALL_LOG_CHANNEL,
      expect.objectContaining({
        runId: 'run-1',
        stream: 'stdout',
        chunk: 'added 1\n',
      })
    );
  });

  it('rejects malformed payloads without spawning', async () => {
    const { registerDependencyHandlers } = await import(
      '../../../src/main/ipc/dependencies'
    );
    registerDependencyHandlers();
    const handler = mocks.handlers.get('dependencies:js:install') as (
      event: { sender: ReturnType<typeof makeSender> },
      ...rest: unknown[]
    ) => Promise<{ outcome: string; failureReason: string | null }>;
    const sender = makeSender();
    const result = await handler({ sender }, 42, 'not-an-array', null);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(result.outcome).toBe('failed');
    expect(result.failureReason).toBe('invalid-specifier');
  });
});
