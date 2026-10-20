import { mkdtempSync } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSecretStore, type SafeStorageLike } from '../../src/main/secretStore';
import { MAX_SECRET_VALUE_LENGTH } from '../../src/shared/secretVault';

function fakeSafeStorage(overrides: Partial<SafeStorageLike> = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from([...Buffer.from(plain, 'utf8')].map((b) => b ^ 0x5a)),
    decryptString: (buf) => Buffer.from([...buf].map((b) => b ^ 0x5a)).toString('utf8'),
    ...overrides,
  };
}

let dir: string;
beforeEach(() => {
  dir = path.join(mkdtempSync(path.join(tmpdir(), 'lingua-secrets-')), 'secrets');
});

describe('createSecretStore (encrypted)', () => {
  it('round-trips a value without writing plaintext to disk', async () => {
    const store = createSecretStore({ dir, safeStorage: fakeSafeStorage(), platform: 'darwin' });
    expect(store.status()).toEqual({ mode: 'encrypted' });
    expect(await store.set('ai.api-key', 'sk-live-123')).toEqual({ ok: true, mode: 'encrypted' });
    expect(await store.get('ai.api-key')).toBe('sk-live-123');
    const raw = await readFile(path.join(dir, 'ai.api-key.secret'));
    expect(raw.toString('utf8')).not.toContain('sk-live-123');
    if (process.platform !== 'win32') {
      expect((await stat(path.join(dir, 'ai.api-key.secret'))).mode & 0o777).toBe(0o600);
    }
  });

  it('rejects invalid ids and oversized values without writing', async () => {
    const store = createSecretStore({ dir, safeStorage: fakeSafeStorage(), platform: 'darwin' });
    expect(await store.set('../escape', 'x')).toEqual({ ok: false, reason: 'invalid-id' });
    expect(await store.set('ai', 'x')).toEqual({ ok: false, reason: 'invalid-id' });
    expect(await store.set('ai.api-key', 'x'.repeat(MAX_SECRET_VALUE_LENGTH + 1))).toEqual({
      ok: false,
      reason: 'invalid-value',
    });
    expect(await store.get('../escape')).toBeNull();
    await expect(readdir(dir)).rejects.toThrow();
  });

  it('lists by prefix and deletes', async () => {
    const store = createSecretStore({ dir, safeStorage: fakeSafeStorage(), platform: 'darwin' });
    await store.set('http-env.e1.v1', 'a');
    await store.set('http-env.e1.v2', 'b');
    await store.set('ai.api-key', 'c');
    expect(await store.list('http-env.')).toEqual(['http-env.e1.v1', 'http-env.e1.v2']);
    expect(await store.list('not a prefix')).toEqual([]);
    expect(await store.delete('http-env.e1.v1')).toBe(true);
    expect(await store.get('http-env.e1.v1')).toBeNull();
    expect(await store.list('http-env.e1.')).toEqual(['http-env.e1.v2']);
  });

  it('returns null for a blob it cannot decrypt', async () => {
    const store = createSecretStore({
      dir,
      safeStorage: fakeSafeStorage({
        decryptString: () => {
          throw new Error('bad blob');
        },
      }),
      platform: 'darwin',
    });
    await store.set('ai.api-key', 'x');
    await writeFile(path.join(dir, 'ai.api-key.secret'), 'garbage');
    expect(await store.get('ai.api-key')).toBeNull();
  });
});

describe('createSecretStore (no keyring)', () => {
  it.each([
    ['basic_text backend on Linux', fakeSafeStorage({ getSelectedStorageBackend: () => 'basic_text' }), 'linux'],
    ['encryption unavailable', fakeSafeStorage({ isEncryptionAvailable: () => false }), 'win32'],
    ['an unrecognised Linux backend', fakeSafeStorage({ getSelectedStorageBackend: () => 'unknown' }), 'linux'],
  ] as const)('keeps values in memory only: %s', async (_label, safeStorage, platform) => {
    const store = createSecretStore({ dir, safeStorage, platform });
    expect(store.status().mode).toBe('session');
    expect(await store.set('ai.api-key', 'sk')).toEqual({ ok: true, mode: 'session' });
    expect(await store.get('ai.api-key')).toBe('sk');
    expect(await store.list('ai.')).toEqual(['ai.api-key']);
    await expect(readdir(dir)).rejects.toThrow();
    const restarted = createSecretStore({ dir, safeStorage, platform });
    expect(await restarted.get('ai.api-key')).toBeNull();
  });

  it('removes temp files left by an interrupted write', async () => {
    const seed = createSecretStore({ dir, safeStorage: fakeSafeStorage(), platform: 'darwin' });
    await seed.set('ai.api-key', 'x');
    await writeFile(path.join(dir, 'ai.api-key.secret.leftover.tmp'), 'partial');
    createSecretStore({ dir, safeStorage: fakeSafeStorage(), platform: 'darwin' });
    await vi.waitFor(async () => expect(await readdir(dir)).toEqual(['ai.api-key.secret']));
  });

  it('lists files from an earlier keyring session so a reset can delete them', async () => {
    await createSecretStore({ dir, safeStorage: fakeSafeStorage(), platform: 'darwin' }).set('http-env.e.v', 'x');
    const noKeyring = createSecretStore({
      dir,
      safeStorage: fakeSafeStorage({ isEncryptionAvailable: () => false }),
      platform: 'darwin',
    });
    expect(await noKeyring.list('http-env.')).toEqual(['http-env.e.v']);
    await noKeyring.delete('http-env.e.v');
    expect(await readdir(dir)).toEqual([]);
  });

  it('reports the Linux backend name', () => {
    const store = createSecretStore({
      dir,
      safeStorage: fakeSafeStorage({ getSelectedStorageBackend: () => 'gnome_libsecret' }),
      platform: 'linux',
    });
    expect(store.status()).toEqual({ mode: 'encrypted', backend: 'gnome_libsecret' });
  });
});
