import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock esbuild-wasm to avoid jsdom TextEncoder incompatibility
vi.mock('esbuild-wasm', () => ({
  initialize: vi.fn(),
  transform: vi.fn(),
}));

// Mock window.runlang for Go runner (IPC calls)
Object.defineProperty(globalThis, 'window', {
  value: {
    ...globalThis.window,
    runlang: {
      platform: 'darwin',
      go: {
        detect: vi.fn().mockResolvedValue({ installed: true, version: 'go1.22.0', goRoot: '/usr/local/go' }),
        compile: vi.fn().mockResolvedValue({ success: false, error: 'mock compile' }),
      },
    },
  },
  writable: true,
});

import { RunnerManager } from '@/runners/manager';

describe('RunnerManager', () => {
  let manager: RunnerManager;

  beforeEach(() => {
    manager = new RunnerManager();
  });

  it('should support javascript, typescript, go, and python', () => {
    expect(manager.isSupported('javascript')).toBe(true);
    expect(manager.isSupported('typescript')).toBe(true);
    expect(manager.isSupported('go')).toBe(true);
    expect(manager.isSupported('python')).toBe(true);
  });

  it('should not support rust yet', () => {
    expect(manager.isSupported('rust')).toBe(false);
  });

  it('should list all supported languages', () => {
    const supported = manager.getSupportedLanguages();
    expect(supported).toContain('javascript');
    expect(supported).toContain('typescript');
    expect(supported).toContain('go');
    expect(supported).toContain('python');
    expect(supported).toHaveLength(4);
  });

  it('should return null runner for unsupported language', async () => {
    const runner = await manager.getRunner('rust');
    expect(runner).toBeNull();
  });

  it('should return error result for unsupported language', async () => {
    const result = await manager.execute('rust', 'fn main() {}');
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('No runner available');
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
    expect(() => manager.stop('rust')).not.toThrow(); // no-op for unsupported
  });
});
