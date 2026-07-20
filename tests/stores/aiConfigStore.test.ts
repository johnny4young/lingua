/**
 * implementation — AI config store. Isolated persist boundary; setters +
 * the `isAiConfigured` gate.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  useAiConfigStore,
  isAiConfigured,
} from '../../src/renderer/stores/aiConfigStore';

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
});
