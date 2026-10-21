import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createSqlHostSupervisor, SqlHostError, type HostChild } from '../../src/main/sqlHostSupervisor';

class FakeChild extends EventEmitter implements HostChild {
  sent: Array<{ id: number; type: string }> = [];
  postMessage(message: unknown) {
    this.sent.push(message as { id: number; type: string });
  }
  kill = vi.fn(() => {
    this.emit('exit', 0);
    return true;
  });
  reply(id: number, result: unknown) {
    this.emit('message', { id, ok: true, result });
  }
}

describe('SQL host supervisor', () => {
  it('starts the host on first use and matches answers to requests', async () => {
    const children: FakeChild[] = [];
    const supervisor = createSqlHostSupervisor(() => {
      const child = new FakeChild();
      children.push(child);
      return child;
    });
    expect(supervisor.isRunning()).toBe(false);
    const a = supervisor.request({ type: 'close-run', runId: 'a' });
    const b = supervisor.request({ type: 'close-run', runId: 'b' });
    const [first, second] = children[0]!.sent;
    children[0]!.reply(second!.id, 'B');
    children[0]!.reply(first!.id, 'A');
    expect(await a).toBe('A');
    expect(await b).toBe('B');
    expect(children).toHaveLength(1);
  });

  it('fails pending requests when the host exits, and starts a new one next time', async () => {
    const children: FakeChild[] = [];
    const supervisor = createSqlHostSupervisor(() => {
      const child = new FakeChild();
      children.push(child);
      return child;
    });
    const pending = supervisor.request({ type: 'close-run', runId: 'a' });
    children[0]!.emit('exit', 1);
    await expect(pending).rejects.toBeInstanceOf(SqlHostError);
    void supervisor.request({ type: 'close-run', runId: 'b' }).catch(() => undefined);
    expect(children).toHaveLength(2);
    supervisor.restart();
    expect(children[1]!.kill).toHaveBeenCalledOnce();
  });

  it('carries the host error detail and times out without stopping the host', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const supervisor = createSqlHostSupervisor(() => child);
    const failing = supervisor.request({ type: 'close-run', runId: 'a' });
    child.emit('message', { id: child.sent[0]!.id, ok: false, error: { message: 'nope', step: 'auth' } });
    await expect(failing).rejects.toMatchObject({ detail: { step: 'auth' } });
    const slow = supervisor.request({ type: 'close-run', runId: 'b' }, 1_000);
    vi.advanceTimersByTime(1_001);
    await expect(slow).rejects.toThrow('did not answer');
    expect(child.kill).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
