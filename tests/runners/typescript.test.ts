import MagicString from 'magic-string';
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

  it('attaches raw-string image and html payloads for rich-media magic comments', async () => {
    const esbuild = await import('esbuild-wasm');
    vi.mocked(esbuild.transform).mockResolvedValue({
      code: 'imageSrc;\nhtml;',
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
            value: 'data:image/png;base64,a',
          },
        } as MessageEvent);
        this.messageHandler?.({
          data: {
            type: 'magic-comment',
            runId: message.runId,
            line: 2,
            value: '<em>ok</em>',
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

      const result = await runner.execute(
        '"data:image/png;base64,a" //=> image\n"<em>ok</em>" //=> html'
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
          html: '<em>ok</em>',
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

  it('forwards rich console payloads from the shared JS worker', async () => {
    const esbuild = await import('esbuild-wasm');
    vi.mocked(esbuild.transform).mockResolvedValue({
      code: 'console.table(rows)',
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
            type: 'console',
            runId: message.runId,
            method: 'log',
            args: ['Table(1×1)'],
            payload: [
              {
                kind: 'table',
                columns: ['name'],
                rows: [
                  [{ kind: 'primitive', type: 'string', repr: '"alice"' }],
                ],
              },
            ],
            consoleTableInvoked: true,
            line: 2,
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

      const result = await runner.execute('console.table(rows)');

      expect(result.stdout).toHaveLength(1);
      expect(result.stdout[0]).toMatchObject({
        type: 'log',
        args: ['Table(1×1)'],
        line: 2,
        payload: [{ kind: 'table', columns: ['name'] }],
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

  it('passes a TS source line map to the worker for normal console output', async () => {
    const esbuild = await import('esbuild-wasm');
    const source = 'console.log("hello")';
    const ms = new MagicString(source);
    ms.prepend('// generated helper\n');
    vi.mocked(esbuild.transform).mockResolvedValue({
      code: ms.toString(),
      map: ms
        .generateMap({
          source: 'scratchpad.ts',
          includeContent: true,
          hires: true,
        })
        .toString(),
      warnings: [],
    });

    const originalWorker = globalThis.Worker;
    let postedLineMap: Record<number, number> | undefined;

    class MockWorker {
      private listeners = new Map<string, (event: MessageEvent) => void>();

      constructor(_url: URL | string, _options?: WorkerOptions) {}

      addEventListener(type: string, handler: (event: MessageEvent) => void): void {
        this.listeners.set(type, handler);
      }

      postMessage(message: { runId?: string; sourceLineMap?: Record<number, number> }): void {
        postedLineMap = message.sourceLineMap;
        const generatedLine = 2;
        const mappedLine = message.sourceLineMap?.[generatedLine] ?? generatedLine;
        const handler = this.listeners.get('message');
        handler?.({
          data: {
            type: 'console',
            runId: message.runId,
            method: 'log',
            args: ['hello'],
            line: mappedLine,
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

      const result = await runner.execute(source);

      expect(postedLineMap?.[2]).toBe(1);
      expect(result.stdout).toEqual([{ type: 'log', args: ['hello'], line: 1 }]);
    } finally {
      Object.defineProperty(globalThis, 'Worker', {
        value: originalWorker,
        writable: true,
        configurable: true,
      });
    }
  });

  // Slice 2 — `outputSourceMappingEnabled` was removed; the worker
  // always receives the source line map. The "skip line map when
  // disabled" case no longer applies.

  it('instruments TypeScript before transpile and surfaces line timings', async () => {
    const esbuild = await import('esbuild-wasm');
    let transpileInput = '';
    vi.mocked(esbuild.transform).mockImplementation(async code => {
      transpileInput = String(code);
      return { code: String(code), map: '', warnings: [] };
    });

    const originalWorker = globalThis.Worker;
    class TimingWorker {
      private handler: ((event: MessageEvent) => void) | null = null;

      addEventListener(type: string, handler: (event: MessageEvent) => void): void {
        if (type === 'message') this.handler = handler;
      }

      postMessage(message: { runId?: string }): void {
        this.handler?.({
          data: {
            type: 'line-timing',
            runId: message.runId,
            entries: [{ line: 2, durationMs: 1.25 }],
          },
        } as MessageEvent);
        this.handler?.({
          data: { type: 'done', runId: message.runId, executionTime: 2 },
        } as MessageEvent);
      }

      terminate(): void {}
    }

    Object.defineProperty(globalThis, 'Worker', {
      value: TimingWorker,
      writable: true,
      configurable: true,
    });

    try {
      const runner = new TypeScriptRunner();
      await runner.init();
      const result = await runner.execute(
        '// @time\nconst answer: number = 42;'
      );

      expect(transpileInput).toContain('__mc_tick(2);');
      expect(result.lineTimings).toEqual([{ line: 2, durationMs: 1.25 }]);
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
