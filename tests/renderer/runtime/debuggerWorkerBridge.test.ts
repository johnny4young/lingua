/**
 * internal — contract test for the debugger worker bridge. The bridge's
 * `DebuggerControlMessage` union is now ALSO consumed by the worker's
 * inbound handler (`WorkerInboundMessage` in js-worker.ts), so this
 * locks the sender side: every variant round-trips verbatim to the
 * registered worker, posting is refused with no worker, and a
 * terminated worker never throws through the bridge.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isDebugWorkerActive,
  postDebuggerMessage,
  setActiveDebugWorker,
} from '@/runtime/debuggerWorkerBridge';

function fakeWorker() {
  return { postMessage: vi.fn() } as unknown as Worker & {
    postMessage: ReturnType<typeof vi.fn>;
  };
}

afterEach(() => {
  setActiveDebugWorker(null);
});

describe('debuggerWorkerBridge', () => {
  it('round-trips every control variant verbatim to the registered worker', () => {
    const worker = fakeWorker();
    setActiveDebugWorker(worker);
    expect(isDebugWorkerActive()).toBe(true);

    const messages = [
      { type: 'resume' },
      { type: 'step', mode: 'into' },
      { type: 'set-breakpoints', breakpoints: [{ line: 3, condition: 'x > 1' }, { line: 9 }] },
    ] as const;
    for (const msg of messages) {
      expect(postDebuggerMessage(msg)).toBe(true);
    }
    expect(worker.postMessage.mock.calls.map(call => call[0])).toEqual(messages);
  });

  it('refuses to post when no worker is registered', () => {
    expect(isDebugWorkerActive()).toBe(false);
    expect(postDebuggerMessage({ type: 'resume' })).toBe(false);
  });

  it('swallows postMessage failures from an already-terminated worker', () => {
    const worker = fakeWorker();
    worker.postMessage.mockImplementation(() => {
      throw new DOMException('terminated');
    });
    setActiveDebugWorker(worker);
    expect(() => postDebuggerMessage({ type: 'resume' })).not.toThrow();
  });

  it('clears the poster when the worker is set to null', () => {
    setActiveDebugWorker(fakeWorker());
    setActiveDebugWorker(null);
    expect(isDebugWorkerActive()).toBe(false);
    expect(postDebuggerMessage({ type: 'resume' })).toBe(false);
  });
});
