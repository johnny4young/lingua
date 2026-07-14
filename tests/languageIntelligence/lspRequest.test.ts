import { describe, expect, it, vi } from 'vitest';
import { requestLspData } from '../../src/renderer/languageIntelligence/lspRequest';

describe('requestLspData', () => {
  it('unwraps successful IPC data', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, data: { items: [] } });

    await expect(
      requestLspData({ request }, 'textDocument/completion', { position: 0 })
    ).resolves.toEqual({ items: [] });
  });

  it('degrades an expected IPC failure to null', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: false,
      reason: 'request-failed',
      message: 'server closed',
    });

    await expect(
      requestLspData({ request }, 'textDocument/hover', { position: 0 })
    ).resolves.toBeNull();
  });
});
