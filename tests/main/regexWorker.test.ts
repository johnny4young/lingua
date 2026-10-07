import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const created: FakeWorker[] = [];

class FakeWorker extends EventEmitter {
  exited = false;
  constructor() {
    super();
    created.push(this);
    queueMicrotask(() => this.emit('online'));
  }
  unref() {}
  terminate() {
    this.exited = true;
    return Promise.resolve(0);
  }
  postMessage(message: { id: number; kind: string }) {
    if (this.exited) return;
    if (created.length === 1) {
      this.exited = true;
      queueMicrotask(() => this.emit('exit', 1));
      return;
    }
    queueMicrotask(() =>
      this.emit('message', { id: message.id, ok: true, value: { replaced: 1, next: 'b' } })
    );
  }
}

vi.mock('node:worker_threads', () => ({ Worker: FakeWorker }));

const { createRegexWorker } = await import('../../src/main/ipc/fs/regexWorker');

const request = { source: 'a', flags: 'g', replacement: 'b', content: 'a', maxCount: 10 };

describe('createRegexWorker', () => {
  beforeEach(() => {
    created.length = 0;
  });

  it('starts a fresh thread after the previous one exits unexpectedly', async () => {
    const worker = createRegexWorker();
    await expect(worker.apply(request, 1_000)).rejects.toThrow('exited unexpectedly');
    await expect(worker.apply(request, 1_000)).resolves.toEqual({ replaced: 1, next: 'b' });
    expect(created).toHaveLength(2);
    worker.dispose();
  });
});
