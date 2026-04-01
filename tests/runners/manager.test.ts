import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock esbuild-wasm to avoid jsdom TextEncoder incompatibility
vi.mock('esbuild-wasm', () => ({
  initialize: vi.fn(),
  transform: vi.fn(),
}));

import { RunnerManager } from '@/runners/manager';

// We can't test actual Worker execution in jsdom, but we can test the manager logic

describe('RunnerManager', () => {
  let manager: RunnerManager;

  beforeEach(() => {
    manager = new RunnerManager();
  });

  it('should support javascript and typescript', () => {
    expect(manager.isSupported('javascript')).toBe(true);
    expect(manager.isSupported('typescript')).toBe(true);
  });

  it('should not support go, python, rust yet', () => {
    expect(manager.isSupported('go')).toBe(false);
    expect(manager.isSupported('python')).toBe(false);
    expect(manager.isSupported('rust')).toBe(false);
  });

  it('should list supported languages', () => {
    const supported = manager.getSupportedLanguages();
    expect(supported).toContain('javascript');
    expect(supported).toContain('typescript');
    expect(supported).toHaveLength(2);
  });

  it('should return null runner for unsupported language', async () => {
    const runner = await manager.getRunner('go');
    expect(runner).toBeNull();
  });

  it('should return error result for unsupported language', async () => {
    const result = await manager.execute('go', 'package main');
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

  it('should stop all runners without error', () => {
    expect(() => manager.stopAll()).not.toThrow();
  });

  it('should stop a specific language runner without error', () => {
    expect(() => manager.stop('javascript')).not.toThrow();
    expect(() => manager.stop('go')).not.toThrow(); // no-op for unsupported
  });
});
