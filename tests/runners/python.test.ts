import { describe, it, expect } from 'vitest';
import { PythonRunner } from '@/runners/python';

describe('PythonRunner', () => {
  it('should have correct metadata', () => {
    const runner = new PythonRunner();
    expect(runner.id).toBe('python');
    expect(runner.name).toBe('Python (Pyodide)');
    expect(runner.language).toBe('python');
    expect(runner.extensions).toContain('.py');
  });

  it('should not be ready before init', () => {
    const runner = new PythonRunner();
    expect(runner.isReady()).toBe(false);
  });

  it('should be ready after init (Pyodide loads lazily)', async () => {
    const runner = new PythonRunner();
    await runner.init();
    expect(runner.isReady()).toBe(true);
  });

  it('should stop without error when no worker is running', () => {
    const runner = new PythonRunner();
    expect(() => runner.stop()).not.toThrow();
  });

  it('should reset state on stop', async () => {
    const runner = new PythonRunner();
    await runner.init();
    runner.stop();
    // After stop, calling stop again should not throw
    expect(() => runner.stop()).not.toThrow();
  });
});
