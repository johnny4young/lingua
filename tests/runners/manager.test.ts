import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock esbuild-wasm to avoid jsdom TextEncoder incompatibility
vi.mock('esbuild-wasm', () => ({
  initialize: vi.fn(),
  transform: vi.fn(),
}));

// Mock window.lingua for Go and Rust runner (IPC calls)
Object.defineProperty(globalThis, 'window', {
  value: {
    ...globalThis.window,
    lingua: {
      platform: 'darwin',
      go: {
        detect: vi.fn().mockResolvedValue({ installed: true, version: 'go1.22.0', goRoot: '/usr/local/go' }),
        compile: vi.fn().mockResolvedValue({ success: false, error: 'mock compile' }),
      },
      rust: {
        detect: vi.fn().mockResolvedValue({ installed: true, version: 'rustc 1.75.0' }),
        run: vi.fn().mockResolvedValue({ success: true, stdout: '', stderr: '', exitCode: 0, executionTime: 0 }),
      },
    },
  },
  writable: true,
});

import { RunnerManager } from '@/runners/manager';
import { pluginRegistry, BasePluginRunner } from '@/plugins';
import type { ExecutionContext, ExecutionResult } from '@/types';

class SmokePluginRunner extends BasePluginRunner {
  id = 'lua';
  name = 'Lua';
  language = 'lua';
  extensions = ['.lua'];

  async execute(_code: string, _context?: ExecutionContext): Promise<ExecutionResult> {
    return {
      stdout: [{ type: 'log', args: ['plugin ok'] }],
      stderr: [],
      result: undefined,
      executionTime: 1,
    };
  }
}

class CountingPluginRunner extends BasePluginRunner {
  id = 'counting';
  name = 'Counting';
  language = 'counting';
  extensions = ['.count'];
  initCalls = 0;

  override async init(): Promise<void> {
    this.initCalls += 1;
    await super.init();
  }

  async execute(_code: string, _context?: ExecutionContext): Promise<ExecutionResult> {
    return {
      stdout: [],
      stderr: [],
      result: undefined,
      executionTime: 1,
    };
  }
}

describe('RunnerManager', () => {
  let manager: RunnerManager;

  beforeEach(() => {
    manager = new RunnerManager();
    pluginRegistry.unregister('lua-smoke');
    pluginRegistry.unregister('counting-smoke');
  });

  it('should support javascript, typescript, go, python, and rust', () => {
    expect(manager.isSupported('javascript')).toBe(true);
    expect(manager.isSupported('typescript')).toBe(true);
    expect(manager.isSupported('go')).toBe(true);
    expect(manager.isSupported('python')).toBe(true);
    expect(manager.isSupported('rust')).toBe(true);
  });

  it('should list all 5 supported languages', () => {
    const supported = manager.getSupportedLanguages();
    expect(supported).toContain('javascript');
    expect(supported).toContain('typescript');
    expect(supported).toContain('go');
    expect(supported).toContain('python');
    expect(supported).toContain('rust');
    expect(supported).toHaveLength(5);
  });

  it('should get rust runner (initializes with detect)', async () => {
    const runner = await manager.getRunner('rust');
    expect(runner).not.toBeNull();
    expect(runner?.id).toBe('rust');
    expect(runner?.language).toBe('rust');
    expect(runner?.isReady()).toBe(true);
  });

  it('should get javascript runner', async () => {
    const runner = await manager.getRunner('javascript');
    expect(runner).not.toBeNull();
    expect(runner?.id).toBe('javascript');
    expect(runner?.language).toBe('javascript');
    expect(runner?.isReady()).toBe(true);
  });

  it('should get go runner (initializes with detect)', async () => {
    const runner = await manager.getRunner('go');
    expect(runner).not.toBeNull();
    expect(runner?.id).toBe('go');
    expect(runner?.language).toBe('go');
    expect(runner?.isReady()).toBe(true);
  });

  it('should get python runner', async () => {
    const runner = await manager.getRunner('python');
    expect(runner).not.toBeNull();
    expect(runner?.id).toBe('python');
    expect(runner?.language).toBe('python');
    expect(runner?.isReady()).toBe(true);
  });

  it('should stop all runners without error', () => {
    expect(() => manager.stopAll()).not.toThrow();
  });

  it('should stop a specific language runner without error', () => {
    expect(() => manager.stop('javascript')).not.toThrow();
    expect(() => manager.stop('go')).not.toThrow();
    expect(() => manager.stop('python')).not.toThrow();
    expect(() => manager.stop('rust')).not.toThrow(); // no-op (native runner)
  });

  it('should execute a registered plugin runner', async () => {
    pluginRegistry.register({
      id: 'lua-smoke',
      name: 'Lua',
      version: '0.1.0',
      language: 'lua',
      extensions: ['.lua'],
      async createRunner() {
        return new SmokePluginRunner();
      },
    });

    expect(manager.isSupported('lua')).toBe(true);

    const result = await manager.execute('lua', 'print("hi")');
    expect(result.stdout[0]?.args[0]).toBe('plugin ok');
  });

  it('prepares a plugin runner only once after it becomes ready', async () => {
    const countingRunner = new CountingPluginRunner();

    pluginRegistry.register({
      id: 'counting-smoke',
      name: 'Counting',
      version: '0.1.0',
      language: 'counting',
      extensions: ['.count'],
      async createRunner() {
        return countingRunner;
      },
    });

    expect(manager.needsInitialization('counting')).toBe(true);

    const firstPreparation = await manager.prepareRunner('counting');
    expect(firstPreparation.runner).toBe(countingRunner);
    expect(firstPreparation.initialized).toBe(true);
    expect(countingRunner.initCalls).toBe(1);

    const secondPreparation = await manager.prepareRunner('counting');
    expect(secondPreparation.runner).toBe(countingRunner);
    expect(secondPreparation.initialized).toBe(false);
    expect(countingRunner.initCalls).toBe(1);
  });
});
