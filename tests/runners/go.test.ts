import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock window.runlang for IPC calls
const mockDetect = vi.fn();
const mockCompile = vi.fn();

Object.defineProperty(globalThis, 'window', {
  value: {
    ...globalThis.window,
    runlang: {
      platform: 'darwin',
      go: {
        detect: mockDetect,
        compile: mockCompile,
      },
    },
  },
  writable: true,
});

import { GoRunner } from '@/runners/go';

describe('GoRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct metadata', () => {
    const runner = new GoRunner();
    expect(runner.id).toBe('go');
    expect(runner.name).toBe('Go');
    expect(runner.language).toBe('go');
    expect(runner.extensions).toContain('.go');
  });

  it('should not be ready before init', () => {
    const runner = new GoRunner();
    expect(runner.isReady()).toBe(false);
  });

  it('should be ready after init when Go is installed', async () => {
    mockDetect.mockResolvedValue({ installed: true, version: 'go1.22.0', goRoot: '/usr/local/go' });
    const runner = new GoRunner();
    await runner.init();
    expect(runner.isReady()).toBe(true);
  });

  it('should throw on init when Go is not installed', async () => {
    mockDetect.mockResolvedValue({ installed: false, error: 'Go is not installed' });
    const runner = new GoRunner();
    await expect(runner.init()).rejects.toThrow('Go is not installed');
    expect(runner.isReady()).toBe(true); // ready is set even if not installed
  });

  it('should return error result when Go is not installed and execute is called', async () => {
    mockDetect.mockResolvedValue({ installed: false, error: 'Go is not installed' });
    const runner = new GoRunner();
    try {
      await runner.init();
    } catch {
      // expected
    }
    const result = await runner.execute('package main\nfunc main() {}');
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Go is not installed');
    expect(result.executionTime).toBe(0);
  });

  it('should return error result when compilation fails', async () => {
    mockDetect.mockResolvedValue({ installed: true, version: 'go1.22.0', goRoot: '/usr/local/go' });
    mockCompile.mockResolvedValue({
      success: false,
      error: './main.go:3:5: undefined: fmt',
    });

    const runner = new GoRunner();
    await runner.init();
    const result = await runner.execute('package main\nfunc main() { fmt.Println("hi") }');

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('fmt');
  });

  it('should stop without error when no worker is running', () => {
    const runner = new GoRunner();
    expect(() => runner.stop()).not.toThrow();
  });

  it('should call detect on init', async () => {
    mockDetect.mockResolvedValue({ installed: true, version: 'go1.22.0', goRoot: '/usr/local/go' });
    const runner = new GoRunner();
    await runner.init();
    expect(mockDetect).toHaveBeenCalledOnce();
  });
});
