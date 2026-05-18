import { describe, it, expect } from 'vitest';
import { JavaScriptRunner } from '@/runners/javascript';

describe('JavaScriptRunner', () => {
  it('should have correct metadata', () => {
    const runner = new JavaScriptRunner();
    expect(runner.id).toBe('javascript');
    expect(runner.name).toBe('JavaScript');
    expect(runner.language).toBe('javascript');
    expect(runner.extensions).toContain('.js');
    expect(runner.extensions).toContain('.mjs');
  });

  it('should not be ready before init', () => {
    const runner = new JavaScriptRunner();
    expect(runner.isReady()).toBe(false);
  });

  it('should be ready after init', async () => {
    const runner = new JavaScriptRunner();
    await runner.init();
    expect(runner.isReady()).toBe(true);
  });

  it('should stop without error when no worker is running', () => {
    const runner = new JavaScriptRunner();
    expect(() => runner.stop()).not.toThrow();
  });

  it('attaches a table payload for table-directed magic comments', async () => {
    const originalWorker = globalThis.Worker;

    class MockWorker {
      private messageHandler: ((event: MessageEvent) => void) | null = null;

      constructor(_url: URL | string, _options?: WorkerOptions) {}

      addEventListener(type: string, handler: (event: MessageEvent) => void): void {
        if (type === 'message') {
          this.messageHandler = handler;
        }
      }

      postMessage(message: { runId?: string }): void {
        this.messageHandler?.({
          data: {
            type: 'magic-comment',
            runId: message.runId,
            line: 1,
            value: '[{"name":"alice","age":30}]',
          },
        } as MessageEvent);
        this.messageHandler?.({
          data: { type: 'done', runId: message.runId, executionTime: 1 },
        } as MessageEvent);
      }

      terminate(): void {}
    }

    Object.defineProperty(globalThis, 'Worker', {
      value: MockWorker,
      writable: true,
      configurable: true,
    });

    try {
      const runner = new JavaScriptRunner();
      await runner.init();

      const result = await runner.execute('rows //=> table');

      expect(result.magicResults?.[0]).toMatchObject({
        line: 1,
        kind: 'arrow',
        payload: {
          kind: 'table',
          columns: ['name', 'age'],
        },
      });
    } finally {
      Object.defineProperty(globalThis, 'Worker', {
        value: originalWorker,
        writable: true,
        configurable: true,
      });
    }
  });
});
