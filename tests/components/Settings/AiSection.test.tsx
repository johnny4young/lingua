/**
 * implementation UX pack — Settings → AI "Detect local AI (Ollama)". Verifies the
 * zero-config path: a reachable local server fills the endpoint + placeholder
 * key and lists models to pick; an unreachable one shows the honest failure
 * copy. All network is stubbed via the fetchImpl seam.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../../src/renderer/i18n';
import { AiSection } from '../../../src/renderer/components/Settings/AiSection';
import { useAiConfigStore } from '../../../src/renderer/stores/aiConfigStore';

let entitled = true;
vi.mock('../../../src/renderer/hooks/useEntitlement', () => ({
  useEntitlement: () => entitled,
}));

function modelsResponse(ids: readonly string[]): Response {
  return new Response(
    JSON.stringify({ object: 'list', data: ids.map((id) => ({ id })) }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

describe('AiSection — detect local AI', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });
  beforeEach(() => {
    entitled = true;
    useAiConfigStore.getState().clear();
  });

  it('fills the endpoint + placeholder key and lists models on success', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe('http://localhost:11434/v1/models');
      return modelsResponse(['qwen3-coder:latest', 'gpt-oss:20b']);
    }) as unknown as typeof fetch;
    render(<AiSection fetchImpl={fetchImpl} />);

    fireEvent.click(screen.getByTestId('ai-settings-detect'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-settings-detect-models')).toBeTruthy()
    );

    const state = useAiConfigStore.getState();
    expect(state.endpoint).toBe('http://localhost:11434/v1/chat/completions');
    expect(state.apiKey).toBe('ollama');

    // Picking a model chip writes it to the store.
    const chips = screen.getAllByTestId('ai-settings-detect-model');
    expect(chips.map((c) => c.textContent)).toEqual([
      'qwen3-coder:latest',
      'gpt-oss:20b',
    ]);
    fireEvent.click(chips[1]!);
    expect(useAiConfigStore.getState().model).toBe('gpt-oss:20b');
  });

  it('keeps a user-typed API key instead of overwriting it', async () => {
    useAiConfigStore.getState().setApiKey('sk-mine');
    const fetchImpl = vi.fn(async () =>
      modelsResponse(['llama3'])
    ) as unknown as typeof fetch;
    render(<AiSection fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByTestId('ai-settings-detect'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-settings-detect-models')).toBeTruthy()
    );
    expect(useAiConfigStore.getState().apiKey).toBe('sk-mine');
  });

  it('shows the failure copy when no server answers', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    render(<AiSection fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByTestId('ai-settings-detect'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-settings-detect-failed')).toBeTruthy()
    );
    // A failed probe must not touch the stored config.
    expect(useAiConfigStore.getState().endpoint).toBe('');
  });

  it('treats an empty model list as a failure', async () => {
    const fetchImpl = vi.fn(async () =>
      modelsResponse([])
    ) as unknown as typeof fetch;
    render(<AiSection fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByTestId('ai-settings-detect'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-settings-detect-failed')).toBeTruthy()
    );
  });
});
