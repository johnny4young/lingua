import { describe, it, expect } from 'vitest';
import { JavaScriptRunner } from '@/runners/javascript';

describe('JavaScriptRunner', () => {
  it('should have correct metadata', () => {
    const runner = new JavaScriptRunner();
    expect(runner.id).toBe('javascript');
    expect(runner.name).toBe('JavaScript');
    expect(runner.language).toBe('javascript');
    expect(runner.extensions).toContain('.js');
    expect(runner.extensions).toContain('.mjs');
  });

  it('should not be ready before init', () => {
    const runner = new JavaScriptRunner();
    expect(runner.isReady()).toBe(false);
  });

  it('should be ready after init', async () => {
    const runner = new JavaScriptRunner();
    await runner.init();
    expect(runner.isReady()).toBe(true);
  });

  it('should stop without error when no worker is running', () => {
    const runner = new JavaScriptRunner();
    expect(() => runner.stop()).not.toThrow();
  });
});
