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
});
