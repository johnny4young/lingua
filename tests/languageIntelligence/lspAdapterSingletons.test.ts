import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __setGoAdapterForTesting,
  getGoLspAdapter,
  loadGoLspAdapter,
} from '@/languageIntelligence/goAdapterSingleton';
import {
  __setRustAdapterForTesting,
  getRustLspAdapter,
  loadRustLspAdapter,
} from '@/languageIntelligence/rustAdapterSingleton';

describe('desktop LSP adapter singletons', () => {
  const originalLingua = window.lingua;

  beforeEach(() => {
    const bridge = {
      request: async () => ({ ok: true as const, data: null }),
      notify: () => {},
      onNotification: () => () => {},
    };
    (window as unknown as { lingua: unknown }).lingua = {
      lsp: {
        go: bridge,
        rust: bridge,
      },
    };
  });

  afterEach(() => {
    __setGoAdapterForTesting(null);
    __setRustAdapterForTesting(null);
    window.lingua = originalLingua;
  });

  it('shares one activation-scoped Go adapter across concurrent callers', async () => {
    const [first, second] = await Promise.all([loadGoLspAdapter(), loadGoLspAdapter()]);

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(getGoLspAdapter()).toBe(first);
  });

  it('shares one activation-scoped Rust adapter across concurrent callers', async () => {
    const [first, second] = await Promise.all([loadRustLspAdapter(), loadRustLspAdapter()]);

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(getRustLspAdapter()).toBe(first);
  });
});
