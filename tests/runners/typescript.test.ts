import { describe, it, expect, vi } from 'vitest';

// Mock esbuild-wasm to avoid jsdom TextEncoder incompatibility
vi.mock('esbuild-wasm', () => ({
  initialize: vi.fn(),
  transform: vi.fn(),
}));

import { TypeScriptRunner } from '@/runners/typescript';

describe('TypeScriptRunner', () => {
  it('should have correct metadata', () => {
    const runner = new TypeScriptRunner();
    expect(runner.id).toBe('typescript');
    expect(runner.name).toBe('TypeScript');
    expect(runner.language).toBe('typescript');
    expect(runner.extensions).toContain('.ts');
    expect(runner.extensions).toContain('.tsx');
  });

  it('should not be ready before init', () => {
    const runner = new TypeScriptRunner();
    expect(runner.isReady()).toBe(false);
  });

  it('should stop without error when no worker is running', () => {
    const runner = new TypeScriptRunner();
    expect(() => runner.stop()).not.toThrow();
  });

  it('attaches a table payload for table-directed magic comments', async () => {
    const esbuild = await import('esbuild-wasm');
    vi.mocked(esbuild.transform).mockResolvedValue({
      code: 'rows;',
      warnings: [],
    });

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
      const runner = new TypeScriptRunner();
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

  it('should preserve worker line numbers on console output', async () => {
    const esbuild = await import('esbuild-wasm');
    vi.mocked(esbuild.transform).mockResolvedValue({
      code: 'console.log("hello")',
      warnings: [],
    });

    const originalWorker = globalThis.Worker;

    class MockWorker {
      private listeners = new Map<string, (event: MessageEvent) => void>();

      constructor(_url: URL | string, _options?: WorkerOptions) {}

      addEventListener(type: string, handler: (event: MessageEvent) => void): void {
        this.listeners.set(type, handler);
      }

      postMessage(message: { runId?: string }): void {
        const handler = this.listeners.get('message');
        handler?.({
          data: {
            type: 'console',
            runId: message.runId,
            method: 'log',
            args: ['hello'],
            line: 3,
          },
        } as MessageEvent);
        handler?.({
          data: { type: 'done', runId: message.runId, executionTime: 4 },
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
      const runner = new TypeScriptRunner();
      await runner.init();

      const result = await runner.execute('console.log("hello")');

      expect(result.stdout).toEqual([{ type: 'log', args: ['hello'], line: 3 }]);
    } finally {
      Object.defineProperty(globalThis, 'Worker', {
        value: originalWorker,
        writable: true,
        configurable: true,
      });
    }
  });

  it('does not let a stale transpile supersede a newer execution', async () => {
    const esbuild = await import('esbuild-wasm');
    let resolveFirstTranspile!: (value: { code: string; warnings: [] }) => void;
    let transformCount = 0;
    vi.mocked(esbuild.transform).mockImplementation(() => {
      transformCount += 1;
      if (transformCount === 1) {
        return new Promise((resolve) => {
          resolveFirstTranspile = resolve;
        });
      }
      return Promise.resolve({ code: 'console.log("new")', warnings: [] });
    });

    const originalWorker = globalThis.Worker;
    let workerCount = 0;

    class MockWorker {
      private listeners = new Map<string, (event: MessageEvent) => void>();

      constructor(_url: URL | string, _options?: WorkerOptions) {
        workerCount += 1;
      }

      addEventListener(type: string, handler: (event: MessageEvent) => void): void {
        this.listeners.set(type, handler);
      }

      postMessage(message: { runId?: string }): void {
        this.listeners.get('message')?.({
          data: { type: 'done', runId: message.runId, executionTime: 4 },
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
      const runner = new TypeScriptRunner();
      await runner.init();

      const staleRun = runner.execute('const value: number = 1');
      await Promise.resolve();
      const newerRun = runner.execute('const value: number = 2');

      await expect(newerRun).resolves.toMatchObject({ error: undefined });

      resolveFirstTranspile({ code: 'console.log("old")', warnings: [] });
      await expect(staleRun).resolves.toMatchObject({
        cancelled: true,
        error: { message: 'Execution stopped by user.' },
      });
      expect(workerCount).toBe(1);
    } finally {
      Object.defineProperty(globalThis, 'Worker', {
        value: originalWorker,
        writable: true,
        configurable: true,
      });
    }
  });

  it('does not spawn a worker after stop() during transpilation', async () => {
    const esbuild = await import('esbuild-wasm');
    let resolveTranspile!: (value: { code: string; warnings: [] }) => void;
    vi.mocked(esbuild.transform).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTranspile = resolve;
        })
    );

    const originalWorker = globalThis.Worker;
    let workerCount = 0;

    class MockWorker {
      constructor(_url: URL | string, _options?: WorkerOptions) {
        workerCount += 1;
      }
    }

    Object.defineProperty(globalThis, 'Worker', {
      value: MockWorker,
      writable: true,
      configurable: true,
    });

    try {
      const runner = new TypeScriptRunner();
      await runner.init();

      const promise = runner.execute('const value: number = 1');
      await Promise.resolve();
      runner.stop();
      resolveTranspile({ code: 'console.log("old")', warnings: [] });

      await expect(promise).resolves.toMatchObject({
        cancelled: true,
        error: { message: 'Execution stopped by user.' },
      });
      expect(workerCount).toBe(0);
    } finally {
      Object.defineProperty(globalThis, 'Worker', {
        value: originalWorker,
        writable: true,
        configurable: true,
      });
    }
  });
});
