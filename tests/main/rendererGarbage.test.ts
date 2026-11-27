// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { collectRendererGarbage } from '../../src/main/rendererGarbage';

type Listener = (event: unknown, method: string, params: unknown) => void;

function fakeContents(options: {
  attached?: boolean;
  attachThrows?: boolean;
  workerSessions?: string[];
  failingSessions?: string[];
} = {}) {
  const listeners = new Set<Listener>();
  const devtools = {
    isAttached: vi.fn(() => options.attached ?? false),
    attach: vi.fn(() => {
      if (options.attachThrows) throw new Error('target closed');
    }),
    detach: vi.fn(),
    on: vi.fn((_name: string, listener: Listener) => listeners.add(listener)),
    off: vi.fn((_name: string, listener: Listener) => listeners.delete(listener)),
    sendCommand: vi.fn(async (method: string, _params?: unknown, sessionId?: string) => {
      if (method === 'Target.setAutoAttach') {
        for (const id of options.workerSessions ?? []) {
          for (const listener of listeners) listener({}, 'Target.attachedToTarget', { sessionId: id });
        }
      }
      if (sessionId && options.failingSessions?.includes(sessionId)) throw new Error('worker gone');
      return {};
    }),
  };
  return { contents: { debugger: devtools } as unknown as WebContents, devtools, listeners };
}

describe('collectRendererGarbage', () => {
  it('collects the page isolate and every worker isolate, then detaches', async () => {
    const { contents, devtools, listeners } = fakeContents({ workerSessions: ['w1', 'w2'] });

    await expect(collectRendererGarbage(contents)).resolves.toBe(3);

    expect(devtools.sendCommand).toHaveBeenCalledWith('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    const collected = devtools.sendCommand.mock.calls
      .filter(([method]) => method === 'HeapProfiler.collectGarbage')
      .map(([, , sessionId]) => sessionId);
    expect(collected).toEqual([undefined, 'w1', 'w2']);
    expect(devtools.detach).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it('counts only the isolates that were collected', async () => {
    const { contents, devtools } = fakeContents({ workerSessions: ['w1', 'w2'], failingSessions: ['w2'] });

    await expect(collectRendererGarbage(contents)).resolves.toBe(2);
    expect(devtools.detach).toHaveBeenCalledTimes(1);
  });

  it('leaves a debugger that something else attached alone', async () => {
    const { contents, devtools } = fakeContents({ attached: true });

    await expect(collectRendererGarbage(contents)).resolves.toBeNull();
    expect(devtools.attach).not.toHaveBeenCalled();
    expect(devtools.detach).not.toHaveBeenCalled();
  });

  it('resolves null when it cannot attach', async () => {
    const { contents, devtools } = fakeContents({ attachThrows: true });

    await expect(collectRendererGarbage(contents)).resolves.toBeNull();
    expect(devtools.sendCommand).not.toHaveBeenCalled();
  });
});
