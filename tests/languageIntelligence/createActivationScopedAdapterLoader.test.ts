import { describe, expect, it, vi } from 'vitest';
import { createActivationScopedAdapterLoader } from '@/languageIntelligence/createActivationScopedAdapterLoader';

interface TestAdapter {
  id: string;
  dispose: () => void;
}

describe('createActivationScopedAdapterLoader', () => {
  it('evicts a rejected load so the next activation can retry', async () => {
    const adapter: TestAdapter = { id: 'ready', dispose: vi.fn() };
    const createAdapter = vi
      .fn<() => Promise<TestAdapter | null>>()
      .mockRejectedValueOnce(new Error('chunk failed'))
      .mockResolvedValueOnce(adapter);
    const loader = createActivationScopedAdapterLoader(createAdapter);

    await expect(loader.load()).rejects.toThrow('chunk failed');
    await expect(loader.load()).resolves.toBe(adapter);
    expect(createAdapter).toHaveBeenCalledTimes(2);
    expect(loader.get()).toBe(adapter);
  });

  it('normalizes a synchronous factory failure into a retryable rejection', async () => {
    const adapter: TestAdapter = { id: 'ready', dispose: vi.fn() };
    const createAdapter = vi
      .fn<() => Promise<TestAdapter | null>>()
      .mockImplementationOnce(() => {
        throw new Error('factory failed');
      })
      .mockResolvedValueOnce(adapter);
    const loader = createActivationScopedAdapterLoader(createAdapter);

    await expect(loader.load()).rejects.toThrow('factory failed');
    await expect(loader.load()).resolves.toBe(adapter);
    expect(createAdapter).toHaveBeenCalledTimes(2);
  });

  it('does not let a late load overwrite an injected adapter', async () => {
    let resolveCandidate: ((adapter: TestAdapter) => void) | undefined;
    const candidate: TestAdapter = { id: 'candidate', dispose: vi.fn() };
    const injected: TestAdapter = { id: 'injected', dispose: vi.fn() };
    const loader = createActivationScopedAdapterLoader(
      () =>
        new Promise<TestAdapter>(resolve => {
          resolveCandidate = resolve;
        })
    );

    const pending = loader.load();
    await Promise.resolve();
    loader.setForTesting(injected);
    resolveCandidate?.(candidate);

    await expect(pending).resolves.toBe(injected);
    expect(candidate.dispose).toHaveBeenCalledTimes(1);
    expect(loader.get()).toBe(injected);
  });
});
