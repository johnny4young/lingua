import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { NativeDapSession } from '../../src/main/debugger/nativeDapSession';
import type { DapClient, DapMessage } from '../../src/main/debugger/dapClient';

function adapter() {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) });
  let listener: ((message: DapMessage) => void) | undefined;
  const client = {
    onEvent: vi.fn((callback: typeof listener) => { listener = callback; return () => {}; }),
    waitForEvent: vi.fn(async () => ({})),
    request: vi.fn(async (command: string) => {
      if (command === 'setBreakpoints') return { breakpoints: [{ verified: true, line: 3 }] };
      if (command === 'configurationDone') listener?.({ seq: 1, type: 'event', event: 'stopped', body: { threadId: 1 } });
      return {};
    }),
    close: vi.fn(),
  };
  return { child, client, emit: (message: DapMessage) => listener?.(message), value: { child: child as unknown as ChildProcessWithoutNullStreams, client: client as unknown as DapClient } };
}
function session(startAdapter: () => Promise<ReturnType<typeof adapter>['value']>) {
  return new NativeDapSession({ runtimeName: 'Fixture', adapterID: 'fixture', scriptPath: '/fixture/main', cwd: '/fixture', env: {}, launchArguments: {}, startAdapter });
}

describe('native DAP startup ownership', () => {
  it('Stop before start never creates an adapter', async () => {
    const a = adapter();
    const startAdapter = vi.fn(async () => a.value);
    const s = session(startAdapter);
    try {
      s.terminate();
      const result = await s.start([3]).catch(error => error);
      expect(startAdapter).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toMatch(/stopped/i);
    } finally { s.terminate(); }
  });

  it('Stop disposes a late adapter without initializing or launching it', async () => {
    const a = adapter();
    let complete!: (value: typeof a.value) => void;
    const s = session(() => new Promise(resolve => { complete = resolve; }));
    const pending = s.start([3]);
    try {
      s.terminate();
      complete(a.value);
      const result = await pending.catch(error => error);
      expect(a.client.request).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toMatch(/stopped/i);
      expect(a.client.close).toHaveBeenCalledTimes(1);
      expect(a.child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally { complete(a.value); await pending.catch(() => {}); s.terminate(); }
  });

  it('reserves startup before the adapter promise resolves', async () => {
    const a = adapter();
    let complete!: (value: typeof a.value) => void;
    const delayed = new Promise<typeof a.value>(resolve => { complete = resolve; });
    const startAdapter = vi.fn(() => delayed);
    const s = session(startAdapter);
    const first = s.start([3]);
    const duplicate = s.start([3]);
    // Observe both immediately so a rejected duplicate cannot become unhandled.
    const outcomes = Promise.allSettled([first, duplicate]);
    try {
      complete(a.value);
      const result = await outcomes;
      expect(startAdapter).toHaveBeenCalledTimes(1);
      expect(result[0].status).toBe('fulfilled');
      expect(result[1].status).toBe('rejected');
    } finally { complete(a.value); await outcomes; s.terminate(); }
  });

  it('ignores late output and pause events after Stop', async () => {
    const a = adapter();
    const s = session(async () => a.value);
    try {
      await s.start([3]);
      s.terminate();
      a.emit({ seq: 2, type: 'event', event: 'output', body: { output: 'late output' } });
      a.emit({ seq: 3, type: 'event', event: 'stopped', body: { threadId: 2 } });
      expect(s.drainOutput().output).toBe('');
      await expect(s.command('continue')).rejects.toThrow(/not running/i);
    } finally { s.terminate(true); }
  });

  it('a failed handshake closes and force-reaps its adapter itself', async () => {
    const a = adapter();
    a.client.request.mockRejectedValueOnce(new Error('initialization refused'));
    const s = session(async () => a.value);
    try {
      await expect(s.start([3])).rejects.toThrow('initialization refused');
      expect(a.client.close).toHaveBeenCalledTimes(1);
      expect(a.child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally { s.terminate(); }
  });
});
