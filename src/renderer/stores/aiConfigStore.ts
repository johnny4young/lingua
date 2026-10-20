/**
 * AI provider configuration (BYO-API-key).
 *
 * Kept in its OWN persist boundary (`lingua-ai`), deliberately isolated from
 * `lingua-settings`: the API key must never ride along in a settings export,
 * a run capsule, a share link, or telemetry. Nothing here is serialized into
 * any of those surfaces — the store is read only by the AI client at send
 * time and by the Settings → AI section for entry.
 *
 * On desktop the key lives in the encrypted secret vault, never in
 * localStorage; on web it stays in this store's localStorage blob. No value
 * is sent anywhere except, on an explicit user "Explain" action, the
 * `Authorization` header of the request to the user's own configured endpoint.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createMigrate } from './persistence/migrationRegistry';
import { AI_API_KEY_SECRET_ID } from '../../shared/secretVault';
import {
  getSecretVault,
  writeSecret,
  writeSecretVerified,
} from '../services/secretVault';

export interface AiConfigState {
  /** Full chat-completions URL (e.g. https://api.openai.com/v1/chat/completions). */
  endpoint: string;
  /** BYO API key. Local-only; never exported/logged. */
  apiKey: string;
  /** Model id (e.g. gpt-4o-mini). */
  model: string;
  /** Persisted marker: the vault holds the key, so boot may load it from there. */
  readonly apiKeyInVault?: boolean;
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

/** Set once the vault reports a real keyring; without one the key stays in localStorage. */
let vaultReady = false;
/** True once the vault holds the key, so the localStorage blob must not. */
let vaultOwnsApiKey = false;
/** Whether the vault currently holds a key; persisted so boot knows to load it. */
let vaultHasKey = false;

function storeKeyInVault(apiKey: string): void {
  const vault = getSecretVault();
  if (!vault || !vaultReady) return;
  void writeSecret(vault, AI_API_KEY_SECRET_ID, apiKey).then((ok) => {
    if (ok) vaultHasKey = apiKey.length > 0;
    if (ok || !vaultOwnsApiKey) return;
    // Keep the key across restarts rather than lose it to a failed write.
    vaultOwnsApiKey = false;
    useAiConfigStore.setState({});
  });
}

export const useAiConfigStore = create<AiConfigState>()(
  persist(
    (set) => ({
      endpoint: '',
      apiKey: '',
      model: '',
      setEndpoint: (endpoint) => set({ endpoint }),
      setApiKey: (apiKey) => {
        set({ apiKey });
        storeKeyInVault(apiKey);
      },
      setModel: (model) => set({ model }),
      clear: () => {
        set({ endpoint: '', apiKey: '', model: '' });
        storeKeyInVault('');
      },
    }),
    {
      name: 'lingua-ai',
      version: 1,
      migrate: createMigrate('lingua-ai'),
      // Only the config fields persist — the actions are recreated.
      partialize: (state) => ({
        endpoint: state.endpoint,
        ...(vaultOwnsApiKey
          ? { apiKeyInVault: vaultHasKey }
          : { apiKey: state.apiKey }),
        model: state.model,
      }),
    }
  )
);

/**
 * Moves a plaintext key left in localStorage by an older build into the
 * vault (copy, read back, then rewrite the blob without it), or loads the
 * vault copy on later boots.
 */
export async function syncAiKeyWithVault(): Promise<void> {
  const vault = getSecretVault();
  if (!vault) return;
  const status = await vault.status().catch(() => null);
  if (status?.mode !== 'encrypted') return;
  vaultReady = true;
  const { apiKey: legacyKey, apiKeyInVault } = useAiConfigStore.getState();
  if (legacyKey) {
    if (await writeSecretVerified(vault, AI_API_KEY_SECRET_ID, legacyKey)) {
      vaultOwnsApiKey = true;
      vaultHasKey = true;
      // A key typed while the copy was in flight.
      const current = useAiConfigStore.getState().apiKey;
      if (current !== legacyKey) storeKeyInVault(current);
      useAiConfigStore.setState({});
    }
    return;
  }
  vaultOwnsApiKey = true;
  vaultHasKey = apiKeyInVault === true;
  if (!vaultHasKey) return;
  const stored = await vault.get(AI_API_KEY_SECRET_ID).catch(() => null);
  if (stored && !useAiConfigStore.getState().apiKey) {
    useAiConfigStore.setState({ apiKey: stored });
  }
}

void syncAiKeyWithVault();
