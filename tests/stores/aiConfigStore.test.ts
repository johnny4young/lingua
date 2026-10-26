/**
 * AI config store. Isolated persist boundary; setters +
 * the `isAiConfigured` gate.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCAL_AI_ENDPOINT,
  useAiConfigStore,
  isAiConfigured,
} from '../../src/renderer/stores/aiConfigStore';
import { migrationRegistry } from '../../src/renderer/stores/persistence/migrationRegistry';

describe('aiConfigStore', () => {
  beforeEach(() => {
    useAiConfigStore.getState().clear();
  });

  it('starts empty and not configured', () => {
    const s = useAiConfigStore.getState();
    expect(s.endpoint).toBe('');
    expect(isAiConfigured(s)).toBe(false);
  });

  it('sets endpoint / key / model independently', () => {
    useAiConfigStore.getState().setEndpoint('https://x/y');
    useAiConfigStore.getState().setApiKey('sk-abc');
    useAiConfigStore.getState().setModel('gpt-4o-mini');
    const s = useAiConfigStore.getState();
    expect(s.endpoint).toBe('https://x/y');
    expect(s.apiKey).toBe('sk-abc');
    expect(s.model).toBe('gpt-4o-mini');
    expect(isAiConfigured(s)).toBe(true);
  });

  it('isAiConfigured requires all three fields', () => {
    expect(isAiConfigured({ endpoint: 'https://x', apiKey: 'k', model: '' })).toBe(false);
    expect(isAiConfigured({ endpoint: '', apiKey: 'k', model: 'm' })).toBe(false);
    expect(isAiConfigured({ endpoint: ' ', apiKey: ' ', model: ' ' })).toBe(false);
  });

  it('clear wipes the key', () => {
    useAiConfigStore.getState().setApiKey('sk-secret');
    useAiConfigStore.getState().clear();
    expect(useAiConfigStore.getState().apiKey).toBe('');
  });

  it('keeps one profile per mode and feeds the active one to the send path', () => {
    const store = useAiConfigStore.getState();
    store.setEndpoint('https://api.example.com/v1/chat/completions');
    store.setModel('gpt');
    store.setApiKey('sk-remote');
    store.setMode('local');
    store.setModel('qwen');
    let s = useAiConfigStore.getState();
    expect([s.endpoint, s.model, s.apiKey]).toEqual([DEFAULT_LOCAL_AI_ENDPOINT, 'qwen', '']);
    expect(isAiConfigured(s)).toBe(true);
    s.setMode('remote');
    s = useAiConfigStore.getState();
    expect([s.endpoint, s.model, s.apiKey]).toEqual(['https://api.example.com/v1/chat/completions', 'gpt', 'sk-remote']);
  });

  it('needs a key only for a server that is not on this machine', () => {
    expect(isAiConfigured({ endpoint: 'http://127.0.0.1:1234/v1/chat/completions', apiKey: '', model: 'm' })).toBe(true);
    expect(isAiConfigured({ endpoint: 'https://api.example.com/v1', apiKey: '', model: 'm' })).toBe(false);
  });

  it('migrates one endpoint into the profile its host belongs to', () => {
    const toV2 = migrationRegistry['lingua-ai'][2]!;
    expect(toV2({ endpoint: 'http://localhost:11434/v1/chat/completions', apiKey: 'ollama', model: 'qwen' })).toEqual({
      mode: 'local',
      local: { endpoint: 'http://localhost:11434/v1/chat/completions', model: 'qwen' },
      remote: { endpoint: '', model: '' },
    });
    expect(toV2({ endpoint: 'https://api.example.com/v1', apiKey: 'sk-x', model: 'gpt' })).toEqual({
      mode: 'remote',
      local: { endpoint: DEFAULT_LOCAL_AI_ENDPOINT, model: '' },
      remote: { endpoint: 'https://api.example.com/v1', model: 'gpt' },
      remoteApiKey: 'sk-x',
    });
    expect(toV2({ endpoint: 'https://api.example.com/v1', apiKeyInVault: true, model: 'gpt' })).toMatchObject({ apiKeyInVault: true });
  });
});
