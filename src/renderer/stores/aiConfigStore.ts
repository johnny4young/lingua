/**
 * AI provider configuration (BYO-API-key).
 *
 * Kept in its OWN persist boundary (`lingua-ai`), deliberately isolated from
 * `lingua-settings`: the API key must never ride along in a settings export,
 * a run capsule, a share link, or telemetry. Nothing here is serialized into
 * any of those surfaces — the store is read only by the AI client at send
 * time and by the Settings → AI section for entry.
 *
 * Two profiles: Local (a server on this machine, no key) and My endpoint
 * (the user's own provider and key). The active one feeds `endpoint`,
 * `apiKey` and `model`, which every AI surface reads. On desktop the key
 * lives in the encrypted secret vault, never in localStorage; on web it stays
 * in this store's localStorage blob. No value
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
import { isLocalAiEndpoint } from '../utils/loopbackHost';

/** Which profile the AI features send to: a server on this machine, or the user's own endpoint. */
export type AiMode = 'local' | 'remote';
export const AI_MODES: readonly AiMode[] = ['local', 'remote'];

export interface AiProfile {
  /** Full chat-completions URL. */
  endpoint: string;
  model: string;
}

export const DEFAULT_LOCAL_AI_ENDPOINT = 'http://localhost:11434/v1/chat/completions';

export interface AiConfigState {
  mode: AiMode;
  local: AiProfile;
  remote: AiProfile;
  /** The My endpoint key. Local servers take none. Local-only; never exported or logged. */
  remoteApiKey: string;
  /** The active profile's endpoint, key and model, kept in step for the send path. */
  endpoint: string;
  apiKey: string;
  model: string;
  /** Persisted marker: the vault holds the key, so boot may load it from there. */
  readonly apiKeyInVault?: boolean;
  setMode: (mode: AiMode) => void;
  /** Edit the active profile. */
  setEndpoint: (endpoint: string) => void;
  setModel: (model: string) => void;
  /** The My endpoint key. */
  setApiKey: (apiKey: string) => void;
  setProfile: (mode: AiMode, patch: Partial<AiProfile>) => void;
  /** Clear all AI config (key included). */
  clear: () => void;
}

/** True when the send path is usable: an endpoint and a model, and a key unless the server is local. */
export function isAiConfigured(
  config: Pick<AiConfigState, 'endpoint' | 'apiKey' | 'model'>
): boolean {
  return (
    config.endpoint.trim().length > 0 &&
    config.model.trim().length > 0 &&
    (config.apiKey.trim().length > 0 || isLocalAiEndpoint(config.endpoint))
  );
}

/** The fields the send path reads, taken from the active profile. */
function activeFields(state: Pick<AiConfigState, 'mode' | 'local' | 'remote' | 'remoteApiKey'>) {
  const profile = state.mode === 'local' ? state.local : state.remote;
  return { endpoint: profile.endpoint, model: profile.model, apiKey: state.mode === 'local' ? '' : state.remoteApiKey };
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

const EMPTY_LOCAL: AiProfile = { endpoint: DEFAULT_LOCAL_AI_ENDPOINT, model: '' };
const EMPTY_REMOTE: AiProfile = { endpoint: '', model: '' };

export const useAiConfigStore = create<AiConfigState>()(
  persist(
    (set) => ({
      mode: 'remote',
      local: EMPTY_LOCAL,
      remote: EMPTY_REMOTE,
      remoteApiKey: '',
      ...activeFields({ mode: 'remote', local: EMPTY_LOCAL, remote: EMPTY_REMOTE, remoteApiKey: '' }),
      setMode: (mode) => set((state) => ({ mode, ...activeFields({ ...state, mode }) })),
      setProfile: (mode, patch) =>
        set((state) => {
          const next = { ...state, [mode]: { ...state[mode], ...patch } };
          return { [mode]: next[mode], ...activeFields(next) };
        }),
      setEndpoint: (endpoint) =>
        set((state) => {
          const next = { ...state, [state.mode]: { ...state[state.mode], endpoint } };
          return { [state.mode]: next[state.mode], ...activeFields(next) };
        }),
      setModel: (model) =>
        set((state) => {
          const next = { ...state, [state.mode]: { ...state[state.mode], model } };
          return { [state.mode]: next[state.mode], ...activeFields(next) };
        }),
      setApiKey: (apiKey) => {
        set((state) => ({ remoteApiKey: apiKey, ...activeFields({ ...state, remoteApiKey: apiKey }) }));
        storeKeyInVault(apiKey);
      },
      clear: () => {
        set({ mode: 'remote', local: EMPTY_LOCAL, remote: EMPTY_REMOTE, remoteApiKey: '', apiKeyInVault: false, ...activeFields({ mode: 'remote', local: EMPTY_LOCAL, remote: EMPTY_REMOTE, remoteApiKey: '' }) });
        storeKeyInVault('');
      },
    }),
    {
      name: 'lingua-ai',
      version: 2,
      migrate: createMigrate('lingua-ai'),
      // Only the profiles persist; the active fields are derived again on load.
      partialize: (state) => ({
        mode: state.mode,
        local: state.local,
        remote: state.remote,
        // Before the vault check runs (a migration writes at once), keep its marker unless a key was typed.
        ...(vaultOwnsApiKey
          ? { apiKeyInVault: vaultHasKey }
          : state.apiKeyInVault && !state.remoteApiKey
            ? { apiKeyInVault: true }
            : { remoteApiKey: state.remoteApiKey }),
      }),
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<AiConfigState> | undefined) };
        return { ...merged, ...activeFields(merged) };
      },
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
  const { remoteApiKey: legacyKey, apiKeyInVault } = useAiConfigStore.getState();
  if (legacyKey) {
    if (await writeSecretVerified(vault, AI_API_KEY_SECRET_ID, legacyKey)) {
      vaultOwnsApiKey = true;
      vaultHasKey = true;
      // A key typed while the copy was in flight.
      const current = useAiConfigStore.getState().remoteApiKey;
      if (current !== legacyKey) storeKeyInVault(current);
      useAiConfigStore.setState({});
    }
    return;
  }
  vaultOwnsApiKey = true;
  vaultHasKey = apiKeyInVault === true;
  if (!vaultHasKey) return;
  const stored = await vault.get(AI_API_KEY_SECRET_ID).catch(() => null);
  if (stored && !useAiConfigStore.getState().remoteApiKey) {
    useAiConfigStore.getState().setApiKey(stored);
  }
}

void syncAiKeyWithVault();
