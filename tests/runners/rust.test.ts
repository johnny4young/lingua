import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock window.lingua for IPC calls
const mockDetect = vi.fn();
const mockRun = vi.fn();

Object.defineProperty(globalThis, 'window', {
  value: {
    ...globalThis.window,
    lingua: {
      platform: 'darwin',
      go: { detect: vi.fn(), compile: vi.fn() },
      rust: {
        detect: mockDetect,
        run: mockRun,
      },
    },
  },
  writable: true,
});

import { RustRunner } from '@/runners/rust';

describe('RustRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct metadata', () => {
    const runner = new RustRunner();
    expect(runner.id).toBe('rust');
    expect(runner.name).toBe('Rust');
    expect(runner.language).toBe('rust');
    expect(runner.extensions).toContain('.rs');
  });

  it('should not be ready before init', () => {
    const runner = new RustRunner();
    expect(runner.isReady()).toBe(false);
  });

  it('should be ready after init when Rust is installed', async () => {
    mockDetect.mockResolvedValue({ installed: true, version: 'rustc 1.75.0' });
    const runner = new RustRunner();
    await runner.init();
    expect(runner.isReady()).toBe(true);
  });

  it('should throw on init when Rust is not installed', async () => {
    mockDetect.mockResolvedValue({
      installed: false,
      error: 'Rust is not installed. Install it from https://rustup.rs',
    });
    const runner = new RustRunner();
    await expect(runner.init()).rejects.toThrow('Rust is not installed');
    expect(runner.isReady()).toBe(true); // ready flag set even when not installed
  });

  it('should return error result when Rust is not installed and execute is called', async () => {
    mockDetect.mockResolvedValue({
      installed: false,
      error: 'Rust is not installed. Install it from https://rustup.rs',
    });
    const runner = new RustRunner();
    try {
      await runner.init();
    } catch {
      // expected
    }
    const result = await runner.execute('fn main() {}');
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Rust is not installed');
    expect(result.executionTime).toBe(0);
  });

  it('should return stdout lines as ConsoleOutput entries on success', async () => {
    mockDetect.mockResolvedValue({ installed: true, version: 'rustc 1.75.0' });
    mockRun.mockResolvedValue({
      success: true,
      stdout: 'Hello, World!\nLine 2\n',
      stderr: '',
      exitCode: 0,
      executionTime: 420,
    });

    const runner = new RustRunner();
    await runner.init();
    const result = await runner.execute('fn main() { println!("Hello, World!"); }');

    expect(result.error).toBeUndefined();
    expect(result.stdout).toHaveLength(2);
    expect(result.stdout[0].args[0]).toBe('Hello, World!');
    expect(result.stdout[1].args[0]).toBe('Line 2');
    expect(result.executionTime).toBe(420);
  });

  it('should return compilation error with line/column when rustc fails', async () => {
    mockDetect.mockResolvedValue({ installed: true, version: 'rustc 1.75.0' });
    mockRun.mockResolvedValue({
      success: false,
      stdout: '',
      stderr:
        'error[E0425]: cannot find value `x` in this scope\n --> main.rs:3:20\n  |\n3 |     println!("{}", x);\n',
      exitCode: 1,
      executionTime: 200,
      error:
        'error[E0425]: cannot find value `x` in this scope\n --> main.rs:3:20',
    });

    const runner = new RustRunner();
    await runner.init();
    const result = await runner.execute('fn main() { println!("{}", x); }');

    expect(result.error).toEqual({
      message: 'error[E0425]: cannot find value `x` in this scope',
      line: 3,
      column: 20,
    });
  });

  it('should stop without error (no-op for native runner)', () => {
    const runner = new RustRunner();
    expect(() => runner.stop()).not.toThrow();
  });

  it('should call detect on init', async () => {
    mockDetect.mockResolvedValue({ installed: true, version: 'rustc 1.75.0' });
    const runner = new RustRunner();
    await runner.init();
    expect(mockDetect).toHaveBeenCalledOnce();
  });
});
