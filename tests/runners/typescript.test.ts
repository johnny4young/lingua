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

      postMessage(): void {
        const handler = this.listeners.get('message');
        handler?.({
          data: { type: 'console', method: 'log', args: ['hello'], line: 3 },
        } as MessageEvent);
        handler?.({ data: { type: 'done', executionTime: 4 } } as MessageEvent);
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
});
