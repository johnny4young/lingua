/**
 * @vitest-environment node
 *
 * RL-087 — watcher lifecycle, failure-path, and `before-quit` cleanup.
 *
 * Runs under the `node` environment because the source module's
 * `node:fs` import cannot be intercepted via `vi.mock` from the
 * default `jsdom` environment. Complements `tests/ipc/fileSystem.test.ts`,
 * which exercises the happy path against real `node:fs`. This file
 * mocks `node:fs.watch` so we can drive the registration-failure
 * branch (EACCES / EMFILE / ENOENT) and verify that:
 *
 *   - The handler does not throw — it returns `{ ok: false, diagnostic }`.
 *   - The typed diagnostic is forwarded over IPC as `fs:watcher-failed`.
 *   - `before-quit` purges every active entry from the watcher registry.
 *   - Re-registering the same `(rootId, path)` stops the prior watcher
 *     (dedup) and switching projects keeps both registrations alive
 *     until the caller stops them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

interface FakeWatcher {
  close: ReturnType<typeof vi.fn>;
  // Real fs.FSWatcher is an EventEmitter; the handler registers an
  // 'error' listener so an async watcher failure cannot crash main.
  on: ReturnType<typeof vi.fn>;
  /** Test seam — invoke the registered 'error' listener. */
  emitError: (error: unknown) => void;
}

type WatchCallback = (eventType: string, filename: string | Buffer | null) => void;

const handlers = vi.hoisted(
  () => new Map<string, (...args: unknown[]) => unknown>()
);
const appListeners = vi.hoisted(
  () => new Map<string, Array<(...args: unknown[]) => void>>()
);
const appOnSpy = vi.hoisted(() =>
  vi.fn((event: string, listener: (...args: unknown[]) => void) => {
    const list = appListeners.get(event) ?? [];
    list.push(listener);
    appListeners.set(event, list);
  })
);
const fakeWatcherInstances = vi.hoisted(() => [] as FakeWatcher[]);
const watchCallbacks = vi.hoisted(() => [] as WatchCallback[]);
const watchImpl = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
  BrowserWindow: { fromWebContents: vi.fn() },
  app: {
    on: appOnSpy,
  },
}));

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return {
    ...actual,
    default: actual,
    watch: watchImpl,
  };
});

import {
  registerFileSystemHandlers,
  _resetBeforeQuitInstallStateForTests,
  _resetWatcherBurstTrackerForTests,
} from '../../src/main/ipc/fileSystem';
import {
  clearRegistryForTests,
  mintRootCapability,
} from '../../src/main/ipc/projectCapabilities';

let tmpRoot: string;
let altRoot: string;

interface FakeSender {
  id: number;
  isDestroyed: () => boolean;
  send: ReturnType<typeof vi.fn>;
  // The watch-start handler registers a one-time 'destroyed' listener to
  // tie watcher lifecycle to the sender (B14). Capture it so tests can
  // fire it and assert the watchers are torn down.
  once: ReturnType<typeof vi.fn>;
  emitDestroyed: () => void;
}

let nextSenderId = 1;
function makeSender(): FakeSender {
  const destroyedListeners: Array<() => void> = [];
  return {
    id: nextSenderId++,
    isDestroyed: () => false,
    send: vi.fn(),
    once: vi.fn((event: string, listener: () => void) => {
      if (event === 'destroyed') destroyedListeners.push(listener);
    }),
    emitDestroyed: () => {
      for (const listener of destroyedListeners) listener();
    },
  };
}

async function invoke(
  channel: string,
  sender: FakeSender,
  ...args: unknown[]
): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler({ sender }, ...args);
}

function mintFor(rootPath: string): { rootId: string; rootPath: string } {
  return mintRootCapability(rootPath);
}

beforeEach(async () => {
  handlers.clear();
  appListeners.clear();
  fakeWatcherInstances.length = 0;
  appOnSpy.mockClear();
  watchImpl.mockReset();
  // Default: behave like a real watcher that never fires.
  watchCallbacks.length = 0;
  watchImpl.mockImplementation((_path, _options, callback: WatchCallback) => {
    watchCallbacks.push(callback);
    const errorListeners: Array<(error: unknown) => void> = [];
    const fake: FakeWatcher = {
      close: vi.fn(),
      on: vi.fn((event: string, listener: (error: unknown) => void) => {
        if (event === 'error') errorListeners.push(listener);
      }),
      emitError: (error: unknown) => {
        for (const listener of errorListeners) listener(error);
      },
    };
    fakeWatcherInstances.push(fake);
    return fake;
  });
  clearRegistryForTests();
  _resetWatcherBurstTrackerForTests();
  _resetBeforeQuitInstallStateForTests();
  registerFileSystemHandlers();
  tmpRoot = await mkdtemp(path.join(process.cwd(), '.tmp-lingua-watch-'));
  altRoot = await mkdtemp(path.join(process.cwd(), '.tmp-lingua-watch-alt-'));
});

afterEach(async () => {
  clearRegistryForTests();
  await rm(tmpRoot, { recursive: true, force: true });
  await rm(altRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------- happy path

describe('fs:watch-start happy path', () => {
  it('returns a watchId and registers exactly one watcher', async () => {
    const { rootId } = mintFor(tmpRoot);
    const sender = makeSender();
    const id = await invoke('fs:watch-start', sender, rootId, '');
    expect(typeof id).toBe('string');
    expect(fakeWatcherInstances).toHaveLength(1);
  });

  it('dedups: a second watch on the same (rootId, path) stops the previous watcher', async () => {
    const { rootId } = mintFor(tmpRoot);
    const sender = makeSender();
    const idA = await invoke('fs:watch-start', sender, rootId, '');
    const firstFake = fakeWatcherInstances[0];

    const idB = await invoke('fs:watch-start', sender, rootId, '');
    expect(idB).not.toBe(idA);
    expect(firstFake.close).toHaveBeenCalledTimes(1);
    expect(fakeWatcherInstances).toHaveLength(2);
  });

  it('keeps watchers from different projects alive in parallel', async () => {
    const { rootId: rootA } = mintFor(tmpRoot);
    const { rootId: rootB } = mintFor(altRoot);
    const sender = makeSender();
    await invoke('fs:watch-start', sender, rootA, '');
    await invoke('fs:watch-start', sender, rootB, '');
    expect(fakeWatcherInstances).toHaveLength(2);
    // Neither was closed by the other registration.
    expect(fakeWatcherInstances[0].close).not.toHaveBeenCalled();
    expect(fakeWatcherInstances[1].close).not.toHaveBeenCalled();
  });

  it('an async watcher error deregisters the watcher and emits fs:watcher-failed instead of crashing', async () => {
    const { rootId } = mintFor(tmpRoot);
    const sender = makeSender();
    const id = await invoke('fs:watch-start', sender, rootId, '');
    expect(typeof id).toBe('string');
    const fake = fakeWatcherInstances[0];

    // Simulate the async EPERM/ENOSPC an FSWatcher emits after registration.
    fake.emitError(Object.assign(new Error('EPERM'), { code: 'EPERM' }));

    // The watcher was closed + a typed diagnostic reached the renderer.
    expect(fake.close).toHaveBeenCalledTimes(1);
    const failedEvents = sender.send.mock.calls.filter(
      ([channel]) => channel === 'fs:watcher-failed'
    );
    expect(failedEvents).toHaveLength(1);

    // The registration slot was freed: re-watching the same target does
    // NOT stop a stale watcher (there is none to stop).
    const idB = await invoke('fs:watch-start', sender, rootId, '');
    expect(idB).not.toBe(id);
    expect(fakeWatcherInstances[1].close).not.toHaveBeenCalled();
  });

  it('disposes a sender-owned watcher when the webContents is destroyed (B14)', async () => {
    const { rootId } = mintFor(tmpRoot);
    const sender = makeSender();
    await invoke('fs:watch-start', sender, rootId, '');
    const fake = fakeWatcherInstances[0];

    // Window close / renderer reload → the sender's 'destroyed' fires.
    sender.emitDestroyed();

    expect(fake.close).toHaveBeenCalledTimes(1);
    // The slot is freed: re-watching the same target does not stop a
    // stale watcher (there is none left to stop).
    const idB = await invoke('fs:watch-start', sender, rootId, '');
    expect(typeof idB).toBe('string');
    expect(fakeWatcherInstances[1].close).not.toHaveBeenCalled();
  });

  it('installs the destroyed listener at most once per sender across multiple watch-starts', async () => {
    const { rootId: rootA } = mintFor(tmpRoot);
    const { rootId: rootB } = mintFor(altRoot);
    const sender = makeSender();
    await invoke('fs:watch-start', sender, rootA, '');
    await invoke('fs:watch-start', sender, rootB, '');

    const destroyedRegistrations = sender.once.mock.calls.filter(
      ([event]) => event === 'destroyed'
    );
    expect(destroyedRegistrations).toHaveLength(1);

    // One destroyed event tears down BOTH watchers the sender owns.
    sender.emitDestroyed();
    expect(fakeWatcherInstances[0].close).toHaveBeenCalledTimes(1);
    expect(fakeWatcherInstances[1].close).toHaveBeenCalledTimes(1);
  });

  it('watch-stop closes the watcher and frees the registration slot', async () => {
    const { rootId } = mintFor(tmpRoot);
    const sender = makeSender();
    const id = await invoke('fs:watch-start', sender, rootId, '');
    const fake = fakeWatcherInstances[0];
    const stopped = await invoke('fs:watch-stop', sender, id as string);
    expect(stopped).toBe(true);
    expect(fake.close).toHaveBeenCalledTimes(1);
    // Re-registering must succeed and produce a fresh watcher (not a
    // duplicate close on the original entry).
    fake.close.mockClear();
    await invoke('fs:watch-start', sender, rootId, '');
    expect(fake.close).not.toHaveBeenCalled();
    expect(fakeWatcherInstances).toHaveLength(2);
  });

  it('emits watcher-degraded once when null-filename events sustain within the burst window', async () => {
    const { rootId } = mintFor(tmpRoot);
    const sender = makeSender();
    await invoke('fs:watch-start', sender, rootId, '');
    expect(watchCallbacks).toHaveLength(1);

    for (let i = 0; i < 21; i += 1) {
      watchCallbacks[0]('rename', null);
    }

    expect(sender.send).toHaveBeenCalledWith(
      'fs:watcher-degraded',
      expect.objectContaining({
        kind: 'system-limit',
        rootId,
        relativePath: '',
      })
    );
    const degradedEvents = sender.send.mock.calls.filter(
      ([channel]) => channel === 'fs:watcher-degraded'
    );
    expect(degradedEvents).toHaveLength(1);
  });
});

// -------------------------------------------------------- failure paths

describe('fs:watch-start failure paths', () => {
  it('returns a typed permission-denied diagnostic on EACCES and emits fs:watcher-failed', async () => {
    const { rootId } = mintFor(tmpRoot);
    const sender = makeSender();
    const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    watchImpl.mockImplementationOnce(() => {
      throw error;
    });

    const result = await invoke('fs:watch-start', sender, rootId, '');
    expect(result).toEqual({
      ok: false,
      diagnostic: {
        kind: 'permission-denied',
        rootId,
        relativePath: '',
        errorMessage: expect.stringContaining('permission denied'),
      },
    });
    expect(sender.send).toHaveBeenCalledWith('fs:watcher-failed', {
      kind: 'permission-denied',
      rootId,
      relativePath: '',
      errorMessage: expect.stringContaining('permission denied'),
    });
    // No watcher registered means none to close.
    expect(fakeWatcherInstances).toHaveLength(0);
  });

  it('classifies EMFILE as system-limit', async () => {
    const { rootId } = mintFor(tmpRoot);
    const sender = makeSender();
    const error = Object.assign(new Error('too many open files'), { code: 'EMFILE' });
    watchImpl.mockImplementationOnce(() => {
      throw error;
    });

    const result = await invoke('fs:watch-start', sender, rootId, '');
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { kind: 'system-limit', rootId, relativePath: '' },
    });
    expect(sender.send).toHaveBeenCalledWith(
      'fs:watcher-failed',
      expect.objectContaining({ kind: 'system-limit' })
    );
  });

  it('classifies ENOSPC as system-limit', async () => {
    const { rootId } = mintFor(tmpRoot);
    const sender = makeSender();
    const error = Object.assign(new Error('inotify exhausted'), { code: 'ENOSPC' });
    watchImpl.mockImplementationOnce(() => {
      throw error;
    });

    const result = await invoke('fs:watch-start', sender, rootId, '');
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { kind: 'system-limit' },
    });
  });

  it('classifies ENOENT as path-not-found', async () => {
    const { rootId } = mintFor(tmpRoot);
    const sender = makeSender();
    const error = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    watchImpl.mockImplementationOnce(() => {
      throw error;
    });

    const result = await invoke('fs:watch-start', sender, rootId, '');
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { kind: 'path-not-found' },
    });
  });

  it('falls back to unknown for unrecognized errno', async () => {
    const { rootId } = mintFor(tmpRoot);
    const sender = makeSender();
    const error = Object.assign(new Error('mystery'), { code: 'EWHATEVER' });
    watchImpl.mockImplementationOnce(() => {
      throw error;
    });

    const result = await invoke('fs:watch-start', sender, rootId, '');
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { kind: 'unknown' },
    });
  });

  it('does not crash when sender is destroyed mid-failure', async () => {
    const { rootId } = mintFor(tmpRoot);
    const destroyedSender: FakeSender = {
      isDestroyed: () => true,
      send: vi.fn(),
    };
    watchImpl.mockImplementationOnce(() => {
      throw Object.assign(new Error('boom'), { code: 'EACCES' });
    });

    const result = await invoke('fs:watch-start', destroyedSender, rootId, '');
    expect(result).toMatchObject({ ok: false });
    expect(destroyedSender.send).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------- before-quit cleanup

describe('before-quit cleanup', () => {
  it('installs a single before-quit listener idempotently', () => {
    // registerFileSystemHandlers was called once in beforeEach.
    const beforeQuitCalls = appOnSpy.mock.calls.filter(
      ([event]) => event === 'before-quit'
    );
    expect(beforeQuitCalls).toHaveLength(1);

    // Calling registerFileSystemHandlers again WITHOUT resetting the
    // install-state flag must be a no-op for the before-quit listener.
    clearRegistryForTests();
    registerFileSystemHandlers();
    const afterSecondRegistration = appOnSpy.mock.calls.filter(
      ([event]) => event === 'before-quit'
    );
    expect(afterSecondRegistration).toHaveLength(1);
  });

  it('closes every active watcher when before-quit fires', async () => {
    const { rootId: rootA } = mintFor(tmpRoot);
    const { rootId: rootB } = mintFor(altRoot);
    const sender = makeSender();
    await invoke('fs:watch-start', sender, rootA, '');
    await invoke('fs:watch-start', sender, rootB, '');
    expect(fakeWatcherInstances).toHaveLength(2);

    const listeners = appListeners.get('before-quit') ?? [];
    expect(listeners.length).toBeGreaterThan(0);
    for (const listener of listeners) {
      listener();
    }

    expect(fakeWatcherInstances[0].close).toHaveBeenCalledTimes(1);
    expect(fakeWatcherInstances[1].close).toHaveBeenCalledTimes(1);
  });

  it('tolerates a watcher that throws on close', async () => {
    const { rootId } = mintFor(tmpRoot);
    const sender = makeSender();
    watchImpl.mockImplementationOnce(() => {
      const fake: FakeWatcher = {
        close: vi.fn(() => {
          throw new Error('close failed');
        }),
        on: vi.fn(),
        emitError: () => {},
      };
      fakeWatcherInstances.push(fake);
      return fake;
    });
    await invoke('fs:watch-start', sender, rootId, '');

    const listeners = appListeners.get('before-quit') ?? [];
    expect(() => listeners.forEach((l) => l())).not.toThrow();
  });
});
