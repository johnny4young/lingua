import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretVaultBridge, SecretWriteResult } from '../../src/shared/secretVault';

interface FakeVault extends SecretVaultBridge {
  readonly values: Map<string, string>;
  failWrites: boolean;
  failDeletes: boolean;
  mode: 'encrypted' | 'session';
}

function fakeVault(): FakeVault {
  const values = new Map<string, string>();
  const vault: FakeVault = {
    values,
    failWrites: false,
    failDeletes: false,
    mode: 'encrypted',
    status: async () => ({ mode: vault.mode }),
    set: async (id, value): Promise<SecretWriteResult> => {
      if (vault.failWrites) return { ok: false, reason: 'write-failed' };
      values.set(id, value);
      return { ok: true, mode: 'encrypted' };
    },
    get: async (id) => values.get(id) ?? null,
    delete: async (id) => {
      if (vault.failDeletes) return { ok: false };
      values.delete(id);
      return { ok: true };
    },
    list: async (prefix) => [...values.keys()].filter((id) => id.startsWith(prefix)),
  };
  return vault;
}

let vault: FakeVault;
const lingua = window as unknown as { lingua?: { secrets?: SecretVaultBridge } };
const originalLingua = lingua.lingua;

function persisted(key: string): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(key) ?? '{}').state ?? {};
}

async function bootAiStore() {
  vi.resetModules();
  return import('../../src/renderer/stores/aiConfigStore');
}

async function bootToolStore() {
  vi.resetModules();
  return import('../../src/renderer/stores/workspaceToolStore');
}

beforeEach(() => {
  localStorage.clear();
  vault = fakeVault();
  lingua.lingua = { ...(originalLingua ?? {}), secrets: vault };
});

afterEach(() => {
  lingua.lingua = originalLingua;
  localStorage.clear();
});

describe('AI key in the secret vault', () => {
  it('moves a legacy plaintext key into the vault and out of localStorage', async () => {
    localStorage.setItem(
      'lingua-ai',
      JSON.stringify({ state: { endpoint: 'https://x/v1', apiKey: 'sk-legacy', model: 'm' }, version: 1 })
    );
    const { useAiConfigStore } = await bootAiStore();
    await vi.waitFor(() => expect(persisted('lingua-ai')).not.toHaveProperty('apiKey'));
    expect(vault.values.get('ai.api-key')).toBe('sk-legacy');
    expect(useAiConfigStore.getState().apiKey).toBe('sk-legacy');
    expect(persisted('lingua-ai')).toMatchObject({ endpoint: 'https://x/v1', model: 'm' });

    const reboot = await bootAiStore();
    await vi.waitFor(() => expect(reboot.useAiConfigStore.getState().apiKey).toBe('sk-legacy'));
  });

  it('keeps the plaintext copy when the vault refuses the write', async () => {
    vault.failWrites = true;
    localStorage.setItem('lingua-ai', JSON.stringify({ state: { apiKey: 'sk-keep' }, version: 1 }));
    const { useAiConfigStore } = await bootAiStore();
    useAiConfigStore.getState().setModel('m');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(persisted('lingua-ai')).toMatchObject({ apiKey: 'sk-keep', model: 'm' });
  });

  it('writes new keys to the vault only, and clear deletes them', async () => {
    const { useAiConfigStore } = await bootAiStore();
    useAiConfigStore.getState().setApiKey('sk-new');
    await vi.waitFor(() => expect(vault.values.get('ai.api-key')).toBe('sk-new'));
    expect(localStorage.getItem('lingua-ai') ?? '').not.toContain('sk-new');
    useAiConfigStore.getState().clear();
    await vi.waitFor(() => expect(vault.values.has('ai.api-key')).toBe(false));
  });

  it('does not bring back a key whose vault delete failed', async () => {
    localStorage.setItem('lingua-ai', JSON.stringify({ state: { apiKey: 'sk-old' }, version: 1 }));
    const first = await bootAiStore();
    await vi.waitFor(() => expect(persisted('lingua-ai')).toMatchObject({ apiKeyInVault: true }));
    vault.failDeletes = true;
    first.useAiConfigStore.getState().clear();
    await vi.waitFor(() => expect(persisted('lingua-ai')).toMatchObject({ apiKey: '' }));
    expect(vault.values.get('ai.api-key')).toBe('sk-old');

    const reboot = await bootAiStore();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reboot.useAiConfigStore.getState().apiKey).toBe('');
  });

  it('leaves the key in localStorage when the system has no keyring', async () => {
    vault.mode = 'session';
    localStorage.setItem('lingua-ai', JSON.stringify({ state: { apiKey: 'sk-linux' }, version: 1 }));
    const { useAiConfigStore } = await bootAiStore();
    await new Promise((resolve) => setTimeout(resolve, 0));
    useAiConfigStore.getState().setModel('m');
    expect(persisted('lingua-ai')).toMatchObject({ apiKey: 'sk-linux', model: 'm' });
    expect(vault.values.size).toBe(0);
  });

  it('keeps localStorage behavior without a vault (web)', async () => {
    lingua.lingua = { ...(originalLingua ?? {}), secrets: undefined };
    const { useAiConfigStore } = await bootAiStore();
    useAiConfigStore.getState().setApiKey('sk-web');
    expect(persisted('lingua-ai')).toMatchObject({ apiKey: 'sk-web' });
  });
});

function legacyEnvironmentBlob(value: string) {
  return JSON.stringify({
    state: {
      requests: [],
      environments: [
        {
          version: 1,
          id: 'env-1',
          name: 'Staging',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
          variables: [
            { id: 'var-token', key: 'API_TOKEN', value, secret: true },
            { id: 'var-base', key: 'BASE', value: 'https://staging', secret: false },
          ],
        },
      ],
      activeEnvironmentId: 'env-1',
    },
    version: 1,
  });
}

describe('HTTP environment secrets in the secret vault', () => {
  const tokenId = 'http-env.env-1.var-token';

  it('moves legacy secret values into the vault and blanks them in localStorage', async () => {
    localStorage.setItem('lingua-workspace-tool-state', legacyEnvironmentBlob('tok-123'));
    const { useWorkspaceToolStore } = await bootToolStore();
    await vi.waitFor(() =>
      expect(localStorage.getItem('lingua-workspace-tool-state') ?? '').not.toContain('tok-123')
    );
    expect(vault.values.get(tokenId)).toBe('tok-123');
    const env = useWorkspaceToolStore.getState().environments[0];
    expect(env.variables.find((v) => v.id === 'var-token')?.value).toBe('tok-123');
    expect(localStorage.getItem('lingua-workspace-tool-state')).toContain('https://staging');

    const reboot = await bootToolStore();
    await vi.waitFor(() =>
      expect(
        reboot.useWorkspaceToolStore.getState().environments[0].variables.find((v) => v.id === 'var-token')
          ?.value
      ).toBe('tok-123')
    );
  });

  it('syncs edits and removals to the vault', async () => {
    localStorage.setItem('lingua-workspace-tool-state', legacyEnvironmentBlob('tok-1'));
    const { useWorkspaceToolStore } = await bootToolStore();
    await vi.waitFor(() => expect(vault.values.get(tokenId)).toBe('tok-1'));
    const rename = (value: string, secret: boolean) =>
      useWorkspaceToolStore.setState((state) => ({
        environments: state.environments.map((env) => ({
          ...env,
          variables: env.variables.map((v) => (v.id === 'var-token' ? { ...v, value, secret } : v)),
        })),
      }));
    rename('tok-2', true);
    await vi.waitFor(() => expect(vault.values.get(tokenId)).toBe('tok-2'));
    rename('tok-2', false);
    await vi.waitFor(() => expect(vault.values.has(tokenId)).toBe(false));
  });

  it('leaves secret values in localStorage when the system has no keyring', async () => {
    vault.mode = 'session';
    localStorage.setItem('lingua-workspace-tool-state', legacyEnvironmentBlob('tok-keep'));
    await bootToolStore();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(localStorage.getItem('lingua-workspace-tool-state')).toContain('tok-keep');
    expect(vault.values.size).toBe(0);
  });

  it('removes vault entries whose variable no longer exists', async () => {
    vault.values.set('http-env.gone.var', 'stale');
    localStorage.setItem('lingua-workspace-tool-state', legacyEnvironmentBlob(''));
    await bootToolStore();
    await vi.waitFor(() => expect(vault.values.has('http-env.gone.var')).toBe(false));
  });
});
