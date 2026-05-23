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

  it('forwards rich payload + console.table flag from worker to ConsoleOutput (RL-044 Slice 1B)', async () => {
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
            type: 'console',
            runId: message.runId,
            method: 'log',
            args: ['Table(2×2)'],
            payload: [
              {
                kind: 'table',
                columns: ['name', 'age'],
                rows: [
                  [
                    { kind: 'primitive', type: 'string', repr: '"alice"' },
                    { kind: 'primitive', type: 'number', repr: '30' },
                  ],
                ],
              },
            ],
            consoleTableInvoked: true,
            line: 1,
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

      const result = await runner.execute('console.table([{name:"alice",age:30}])');

      expect(result.stdout).toHaveLength(1);
      const entry = result.stdout[0]!;
      expect(entry.args).toEqual(['Table(2×2)']);
      expect(entry.payload).toBeDefined();
      expect(entry.payload![0]).toMatchObject({
        kind: 'table',
        columns: ['name', 'age'],
      });
    } finally {
      Object.defineProperty(globalThis, 'Worker', {
        value: originalWorker,
        writable: true,
        configurable: true,
      });
    }
  });

  it('omits payload field when the worker sends no `payload` (legacy path stays the fallback)', async () => {
    const originalWorker = globalThis.Worker;

    class MockWorker {
      private messageHandler: ((event: MessageEvent) => void) | null = null;
      constructor(_url: URL | string, _options?: WorkerOptions) {}
      addEventListener(type: string, handler: (event: MessageEvent) => void): void {
        if (type === 'message') this.messageHandler = handler;
      }
      postMessage(message: { runId?: string }): void {
        this.messageHandler?.({
          data: {
            type: 'console',
            runId: message.runId,
            method: 'log',
            args: ['hello'],
            line: 1,
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
      const result = await runner.execute('console.log("hello")');
      const entry = result.stdout[0]!;
      expect(entry.args).toEqual(['hello']);
      expect(entry.payload).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, 'Worker', {
        value: originalWorker,
        writable: true,
        configurable: true,
      });
    }
  });

  // Slice 2 — `outputSourceMappingEnabled` was removed from
  // `ExecutionContext`; the worker always receives
  // `sourceMappingEnabled: true`. The "OFF state forwards false" case
  // no longer applies.

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

  it('attaches image and html payloads for raw-string rich-media magic comments', async () => {
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
            value: 'data:image/png;base64,a',
          },
        } as MessageEvent);
        this.messageHandler?.({
          data: {
            type: 'magic-comment',
            runId: message.runId,
            line: 2,
            value: '<strong>ok</strong>',
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

      const result = await runner.execute(
        '"data:image/png;base64,a" //=> image\n"<strong>ok</strong>" //=> html'
      );

      expect(result.magicResults?.[0]).toMatchObject({
        line: 1,
        payload: {
          kind: 'image',
          src: 'data:image/png;base64,a',
          mime: 'image/png',
        },
      });
      expect(result.magicResults?.[1]).toMatchObject({
        line: 2,
        payload: {
          kind: 'html',
          html: '<strong>ok</strong>',
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

  it('attaches chart payloads for JSON rich-media magic comments', async () => {
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
            value:
              '{"mark":"bar","data":{"values":[{"label":"A","value":1}]},"encoding":{"x":{"field":"label","type":"nominal"},"y":{"field":"value","type":"quantitative"}}}',
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

      const result = await runner.execute('spec //=> chart');

      expect(result.magicResults?.[0]).toMatchObject({
        line: 1,
        payload: {
          kind: 'chart',
          spec: {
            mark: 'bar',
            data: { values: [{ label: 'A', value: 1 }] },
          },
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

  it('keeps the text fallback entry visible when the worker emits a richMediaRejected flag (RL-044 Slice 2b-β-β-α fold A telemetry fires fire-and-forget)', async () => {
    const originalWorker = globalThis.Worker;

    class MockWorker {
      private messageHandler: ((event: MessageEvent) => void) | null = null;
      constructor(_url: URL | string, _options?: WorkerOptions) {}
      addEventListener(type: string, handler: (event: MessageEvent) => void): void {
        if (type === 'message') this.messageHandler = handler;
      }
      postMessage(message: { runId?: string }): void {
        this.messageHandler?.({
          data: {
            type: 'console',
            runId: message.runId,
            method: 'log',
            args: ['[chart rejected: remote/named data not allowed (use data.values inline)]'],
            line: 1,
            richMediaRejected: { kind: 'chart', reason: 'validation-failed' },
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
      const result = await runner.execute('lingua.chart({ data: { url: "x" } })');
      const entry = result.stdout[0]!;
      expect(entry.args?.[0]).toContain('chart rejected');
      // Telemetry forwarding fires inside the runner (fire-and-forget);
      // the test asserts the path doesn't drop or mutate the entry.
      expect(entry.payload).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, 'Worker', {
        value: originalWorker,
        writable: true,
        configurable: true,
      });
    }
  });
});
