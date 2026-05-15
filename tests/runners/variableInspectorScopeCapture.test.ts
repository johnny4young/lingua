import { describe, expect, it, vi } from 'vitest';

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

describe('RL-020 Slice 9 — runner scope-capture wiring', () => {
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
    vi.mocked(esbuild.transform).mockResolvedValue({
      code: 'const answer = 42;\nclass Box {}',
      warnings: [],
    });

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
});
