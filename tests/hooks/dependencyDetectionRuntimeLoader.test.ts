import { describe, expect, it, vi } from 'vitest';
import {
  createDependencyDetectionRuntimeLoader,
  type DependencyDetectionRuntimeModule,
} from '../../src/renderer/hooks/dependencyDetectionRuntimeLoader';

const runtimeModule = {
  classifyDependencies: vi.fn(),
} as unknown as DependencyDetectionRuntimeModule;

describe('dependency detection runtime loader', () => {
  it('shares concurrent imports and caches the fulfilled runtime', async () => {
    const importRuntime = vi.fn().mockResolvedValue(runtimeModule);
    const loader = createDependencyDetectionRuntimeLoader(importRuntime);

    const first = loader.load();
    const second = loader.load();

    expect(first).toBe(second);
    await expect(first).resolves.toBe(runtimeModule);
    await expect(loader.load()).resolves.toBe(runtimeModule);
    expect(importRuntime).toHaveBeenCalledTimes(1);
  });

  it('evicts a rejected import so the next activation can retry', async () => {
    const error = new Error('chunk unavailable');
    const importRuntime = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(runtimeModule);
    const loader = createDependencyDetectionRuntimeLoader(importRuntime);

    await expect(loader.load()).rejects.toBe(error);
    await expect(loader.load()).resolves.toBe(runtimeModule);
    expect(importRuntime).toHaveBeenCalledTimes(2);
  });
});
