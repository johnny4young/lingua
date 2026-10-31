import { describe, expect, it, vi } from 'vitest';
import { transformResult } from '../__fixtures__/esbuildTransform';

vi.mock('esbuild-wasm', () => ({
  initialize: vi.fn(),
  transform: vi.fn(),
}));

import { JavaScriptRunner } from '@/runners/javascript';
import { TypeScriptRunner } from '@/runners/typescript';

function installCapturingWorker() {
  const originalWorker = globalThis.Worker;
  let posted: Record<string, unknown> | null = null;

  class MockWorker {
    private messageHandler: ((event: MessageEvent) => void) | null = null;

    constructor(_url: URL | string, _options?: WorkerOptions) {}

    addEventListener(type: string, handler: (event: MessageEvent) => void): void {
      if (type === 'message') this.messageHandler = handler;
    }

    postMessage(message: Record<string, unknown>): void {
      posted = message;
      this.messageHandler?.({
        data: {
          type: 'done',
          runId: message.runId,
          executionTime: 1,
        },
      } as MessageEvent);
    }

    terminate(): void {}
  }

  Object.defineProperty(globalThis, 'Worker', {
    value: MockWorker,
    writable: true,
    configurable: true,
  });

  return {
    getPosted: () => posted,
    restore: () =>
      Object.defineProperty(globalThis, 'Worker', {
        value: originalWorker,
        writable: true,
        configurable: true,
      }),
  };
}

describe('runner scope-capture wiring', () => {
  it('injects a lexical scope capture into JavaScript runs', async () => {
    const worker = installCapturingWorker();
    try {
      const runner = new JavaScriptRunner();
      await runner.init();
      await runner.execute('const answer = 42;\nlet label = "ok";', {
        captureScope: true,
      });

      const posted = worker.getPosted();
      expect(posted?.captureScope).toBe(true);
      expect(posted?.code).toContain('__lingua_capture_scope');
      expect(posted?.code).toContain('"answer": () => answer');
      expect(posted?.code).toContain('"label": () => label');
    } finally {
      worker.restore();
    }
  });

  it('injects a lexical scope capture into transpiled TypeScript runs', async () => {
    const esbuild = await import('esbuild-wasm');
    vi.mocked(esbuild.transform).mockResolvedValue(
      transformResult('const answer = 42;\nclass Box {}')
    );

    const worker = installCapturingWorker();
    try {
      const runner = new TypeScriptRunner();
      await runner.init();
      await runner.execute('const answer: number = 42;\nclass Box {}', {
        captureScope: true,
      });

      const posted = worker.getPosted();
      expect(posted?.captureScope).toBe(true);
      expect(posted?.scopeLanguage).toBe('typescript');
      expect(posted?.code).toContain('__lingua_capture_scope');
      expect(posted?.code).toContain('"answer": () => answer');
      expect(posted?.code).toContain('"Box": () => Box');
    } finally {
      worker.restore();
    }
  });

  it('records instead of capturing scope or timing when Record run is asked', async () => {
    const worker = installCapturingWorker();
    try {
      const runner = new JavaScriptRunner();
      await runner.init();
      await runner.execute('const answer = 42;\nif (answer) {\n  console.log(answer);\n}', {
        captureScope: true,
        lineTiming: true,
        record: true,
      });
      const posted = worker.getPosted();
      expect(posted?.record).toBe(true);
      expect(posted?.captureScope).toBe(false);
      expect(posted?.code).toContain('__lingua_rec(3,');
      expect(posted?.code).not.toContain('__mc_tick');
    } finally {
      worker.restore();
    }
  });

  it('records TypeScript on its source lines', async () => {
    const esbuild = await import('esbuild-wasm');
    vi.mocked(esbuild.transform).mockResolvedValue(transformResult('const answer = 42;\nconsole.log(answer);'));
    const worker = installCapturingWorker();
    try {
      const runner = new TypeScriptRunner();
      await runner.init();
      await runner.execute('const answer: number = 42;\nconsole.log(answer);', { record: true });
      const posted = worker.getPosted();
      expect(posted?.record).toBe(true);
      expect(posted?.code).toContain('__lingua_rec(1,');
      expect(posted?.code).toContain('__lingua_rec(2,');
    } finally {
      worker.restore();
    }
  });

  it('checks the timeline the worker posts before it reaches the result', async () => {
    const originalWorker = globalThis.Worker;
    class TimelineWorker {
      private handler: ((event: MessageEvent) => void) | null = null;
      addEventListener(type: string, handler: (event: MessageEvent) => void): void {
        if (type === 'message') this.handler = handler;
      }
      postMessage(message: Record<string, unknown>): void {
        const forged = { steps: [{ line: 'x', frames: [{ name: { evil: true }, line: 1 }], vars: [] }], truncated: 'no' };
        this.handler?.({ data: { type: 'timeline', runId: message.runId, timeline: forged } } as MessageEvent);
        this.handler?.({ data: { type: 'done', runId: message.runId, executionTime: 1 } } as MessageEvent);
      }
      terminate(): void {}
    }
    Object.defineProperty(globalThis, 'Worker', { value: TimelineWorker, writable: true, configurable: true });
    try {
      const runner = new JavaScriptRunner();
      await runner.init();
      const result = await runner.execute('const a = 1;', { record: true });
      expect(result.timeline).toEqual({ steps: [{ line: 0, frames: [{ name: '<anonymous>', line: 1 }], vars: [] }], truncated: false });
    } finally {
      Object.defineProperty(globalThis, 'Worker', { value: originalWorker, writable: true, configurable: true });
    }
  });
});
