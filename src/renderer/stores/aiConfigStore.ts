/**
 * T19 / RL-031 Slice 3 — AI provider configuration (BYO-API-key).
 *
 * Kept in its OWN persist boundary (`lingua-ai`), deliberately isolated from
 * `lingua-settings`: the API key must never ride along in a settings export,
 * a run capsule, a share link, or telemetry. Nothing here is serialized into
 * any of those surfaces — the store is read only by the AI client at send
 * time and by the Settings → AI section for entry.
 *
 * Local-only: this is renderer localStorage. No value is sent anywhere except,
 * on an explicit user "Explain" action, the `Authorization` header of the
 * request to the user's own configured endpoint.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AiConfigState {
  /** Full chat-completions URL (e.g. https://api.openai.com/v1/chat/completions). */
  endpoint: string;
  /** BYO API key. Local-only; never exported/logged. */
  apiKey: string;
  /** Model id (e.g. gpt-4o-mini). */
  model: string;
  setEndpoint: (endpoint: string) => void;
  setApiKey: (apiKey: string) => void;
  setModel: (model: string) => void;
  /** Clear all AI config (key included). */
  clear: () => void;
}

/** True when endpoint + key + model are all set — the send path is usable. */
export function isAiConfigured(
  config: Pick<AiConfigState, 'endpoint' | 'apiKey' | 'model'>
): boolean {
  return (
    config.endpoint.trim().length > 0 &&
    config.apiKey.trim().length > 0 &&
    config.model.trim().length > 0
  );
}

export const useAiConfigStore = create<AiConfigState>()(
  persist(
    (set) => ({
      endpoint: '',
      apiKey: '',
      model: '',
      setEndpoint: (endpoint) => set({ endpoint }),
      setApiKey: (apiKey) => set({ apiKey }),
      setModel: (model) => set({ model }),
      clear: () => set({ endpoint: '', apiKey: '', model: '' }),
    }),
    {
      name: 'lingua-ai',
      // Only the three config fields persist — the actions are recreated.
      partialize: (state) => ({
        endpoint: state.endpoint,
        apiKey: state.apiKey,
        model: state.model,
      }),
    }
  )
);
