import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onOwnerReset } from '../../src/main/runners/ownerReset';
import {
  NATIVE_RUN_OWNER_GONE,
  createNativeRunLifecycle,
} from '../../src/main/runners/nativeRunLifecycle';

const ipcHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
const terminal = vi.hoisted(() => ({
  start: vi.fn(async () => ({ ok: true, sessionId: 'pty-1', shellName: 'sh' })),
  disposeForOwner: vi.fn(() => 0),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler);
    },
  },
}));
vi.mock('../../src/main/ipc/projectCapabilities', () => ({
  resolveCapabilityPath: async () => ({ ok: true, absolutePath: '/trusted/project' }),
}));
vi.mock('../../src/main/projectTerminal', () => ({
  startProjectTerminal: terminal.start,
  disposeProjectTerminalSessionsForOwner: terminal.disposeForOwner,
  resizeProjectTerminal: vi.fn(),
  stopProjectTerminal: vi.fn(),
  writeProjectTerminal: vi.fn(),
}));

class FakeOwner extends EventEmitter {
  constructor(readonly id = 3) {
    super();
  }
  isDestroyed() {
    return false;
  }
}

const RESET_EVENTS = ['destroyed', 'did-navigate', 'render-process-gone'];

function listenerTotal(owner: EventEmitter): number {
  return RESET_EVENTS.reduce((total, event) => total + owner.listenerCount(event), 0);
}

beforeEach(() => {
  terminal.start.mockClear();
  terminal.disposeForOwner.mockClear();
});

describe('onOwnerReset', () => {
  it('fires on every reload or renderer crash and once more on destroy', () => {
    const owner = new FakeOwner();
    const reset = vi.fn();
    onOwnerReset(owner, reset);
    onOwnerReset(owner, vi.fn());
    expect(listenerTotal(owner)).toBe(3);

    owner.emit('did-navigate');
    owner.emit('did-navigate');
    owner.emit('render-process-gone');
    expect(reset).toHaveBeenCalledTimes(3);
    expect(listenerTotal(owner)).toBe(3);

    owner.emit('destroyed');
    expect(reset).toHaveBeenCalledTimes(4);
    expect(listenerTotal(owner)).toBe(0);
  });

  it('removes its listeners when the last subscriber leaves', () => {
    const owner = new FakeOwner();
    const reset = vi.fn();
    const first = onOwnerReset(owner, reset);
    const second = onOwnerReset(owner, vi.fn());
    first();
    expect(listenerTotal(owner)).toBe(3);
    second();
    expect(listenerTotal(owner)).toBe(0);
    owner.emit('did-navigate');
    expect(reset).not.toHaveBeenCalled();
  });

  it('keeps running later subscribers when one throws', () => {
    const owner = new FakeOwner();
    const later = vi.fn();
    onOwnerReset(owner, () => {
      throw new Error('boom');
    });
    onOwnerReset(owner, later);
    owner.emit('did-navigate');
    expect(later).toHaveBeenCalledOnce();
  });

  it('aborts native runs owned by a reloaded renderer', () => {
    const owner = new FakeOwner();
    const run = createNativeRunLifecycle(owner);
    owner.emit('did-navigate');
    expect(run.controller.signal.aborted).toBe(true);
    expect(run.controller.signal.reason).toBe(NATIVE_RUN_OWNER_GONE);

    const next = createNativeRunLifecycle(owner);
    expect(next.controller.signal.aborted).toBe(false);
    run.release();
    next.release();
    expect(listenerTotal(owner)).toBe(0);
  });

  it('disposes project terminals on every reload so the session cap never fills', async () => {
    const { registerProjectTerminalHandlers } = await import('../../src/main/ipc/projectTerminal');
    registerProjectTerminalHandlers();
    const owner = Object.assign(new FakeOwner(21), { send: vi.fn() });
    const start = ipcHandlers.get('project-terminal:start')!;

    for (let reload = 1; reload <= 5; reload += 1) {
      await start({ sender: owner }, 'root', 80, 24);
      owner.emit('did-navigate');
      expect(terminal.disposeForOwner).toHaveBeenCalledTimes(reload);
      expect(terminal.disposeForOwner).toHaveBeenLastCalledWith(21);
    }
  });
});
