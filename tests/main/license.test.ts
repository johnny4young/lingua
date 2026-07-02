/**
 * RL-059 Slice 0 — main-side license runtime + IPC bridge.
 *
 * Coverage:
 * - persisted-license atomic round trip (write / read / clear)
 * - device-id mint-once + reuse across runtime instances
 * - createLicenseRuntime against a fixture keypair (active / invalid /
 *   stale-on-disk wipe / revalidate / clear)
 * - registerLicenseHandlers wiring the `license:*` channels to runtime
 *   methods
 *
 * Pure node — `electron` is mocked exactly the way `tests/main/consent.test.ts`
 * mocks it so this file runs under vitest's JSDOM-free pool without booting
 * an actual main process.
 */

import { mkdtempSync } from 'node:fs';
import { chmod, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signLicenseTokenForTest } from '../__fixtures__/license';

const ipcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler);
    },
  },
}));

let publicKeyJwk: JsonWebKey;
let privateKeyJwk: JsonWebKey;
let otherPublicKeyJwk: JsonWebKey;

beforeAll(async () => {
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;
  publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  const otherPair = (await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;
  otherPublicKeyJwk = await crypto.subtle.exportKey('jwk', otherPair.publicKey);
});

describe('main-side license persistence', () => {
  let tempDir: string;

  beforeEach(() => {
    ipcHandlers.clear();
    vi.resetModules();
    tempDir = mkdtempSync(path.join(tmpdir(), 'lingua-license-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('readPersistedLicense returns null when the file is missing', async () => {
    const { readPersistedLicense, resolveLicensePath } = await import('../../src/main/license');
    const file = resolveLicensePath(tempDir);
    expect(await readPersistedLicense(file)).toBeNull();
  });

  it('writePersistedLicense + readPersistedLicense round-trip a token', async () => {
    const { readPersistedLicense, writePersistedLicense, resolveLicensePath } = await import(
      '../../src/main/license'
    );
    const file = resolveLicensePath(tempDir);
    await writePersistedLicense(file, { token: 'abc.def', lastVerifiedAt: 1234 });
    expect(await readPersistedLicense(file)).toEqual({ token: 'abc.def', lastVerifiedAt: 1234 });
  });

  it('writePersistedLicense uses a unique temporary file per concurrent write', async () => {
    const { readPersistedLicense, writePersistedLicense, resolveLicensePath } = await import(
      '../../src/main/license'
    );
    const file = resolveLicensePath(tempDir);

    await Promise.all([
      writePersistedLicense(file, { token: 'first.token', lastVerifiedAt: 1 }),
      writePersistedLicense(file, { token: 'second.token', lastVerifiedAt: 2 }),
    ]);

    const persisted = await readPersistedLicense(file);
    expect(['first.token', 'second.token']).toContain(persisted?.token);
    const entries = await readdir(tempDir);
    expect(entries.filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('writePersistedLicense removes the temporary file when the final rename fails', async () => {
    const { writePersistedLicense, resolveLicensePath } = await import('../../src/main/license');
    const file = resolveLicensePath(tempDir);
    await mkdir(file);

    await expect(
      writePersistedLicense(file, { token: 'abc.def', lastVerifiedAt: 1234 })
    ).rejects.toBeInstanceOf(Error);

    const entries = await readdir(tempDir);
    expect(entries.filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('readPersistedLicense returns null on malformed JSON so a corrupt file never grants a tier', async () => {
    const { readPersistedLicense, resolveLicensePath } = await import('../../src/main/license');
    const file = resolveLicensePath(tempDir);
    await writeFile(file, '{ not json', 'utf-8');
    expect(await readPersistedLicense(file)).toBeNull();
  });

  it('clearPersistedLicense unlinks the file and is a no-op when it does not exist', async () => {
    const { writePersistedLicense, clearPersistedLicense, resolveLicensePath, readPersistedLicense } =
      await import('../../src/main/license');
    const file = resolveLicensePath(tempDir);
    await writePersistedLicense(file, { token: 'abc.def', lastVerifiedAt: 1 });
    await clearPersistedLicense(file);
    expect(await readPersistedLicense(file)).toBeNull();
    // Idempotent — second call must not throw.
    await clearPersistedLicense(file);
  });

  it.skipIf(process.platform === 'win32')(
    'writePersistedLicense produces an owner-only readable file on POSIX',
    async () => {
      const { writePersistedLicense, resolveLicensePath } = await import('../../src/main/license');
      const file = resolveLicensePath(tempDir);
      await writePersistedLicense(file, { token: 'abc.def', lastVerifiedAt: 1 });
      const info = await stat(file);
      expect(info.mode & 0o777).toBe(0o600);
    }
  );

  it('loadOrCreateDeviceId mints once and reuses the same id on a second call', async () => {
    const { loadOrCreateDeviceId, resolveDeviceIdPath } = await import('../../src/main/license');
    const file = resolveDeviceIdPath(tempDir);
    const first = await loadOrCreateDeviceId(file);
    const second = await loadOrCreateDeviceId(file);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('loadOrCreateDeviceId mints fresh if the persisted shape is malformed', async () => {
    const { loadOrCreateDeviceId, resolveDeviceIdPath } = await import('../../src/main/license');
    const file = resolveDeviceIdPath(tempDir);
    await writeFile(file, JSON.stringify({ deviceId: 42 }), 'utf-8');
    const id = await loadOrCreateDeviceId(file);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('loadOrCreateDeviceId falls back to an ephemeral id when the file cannot be written', async () => {
    const { loadOrCreateDeviceId } = await import('../../src/main/license');
    const missingParentFile = path.join(tempDir, 'missing-parent', 'device-id.json');
    const id = await loadOrCreateDeviceId(missingParentFile);
    expect(id).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('parseEmbeddedPublicKey returns null for empty or malformed input so a misconfigured build fails closed', async () => {
    const { parseEmbeddedPublicKey } = await import('../../src/main/license');
    expect(parseEmbeddedPublicKey(undefined)).toBeNull();
    expect(parseEmbeddedPublicKey('')).toBeNull();
    expect(parseEmbeddedPublicKey('{')).toBeNull();
    expect(parseEmbeddedPublicKey(JSON.stringify(publicKeyJwk))).toMatchObject({
      kty: publicKeyJwk.kty,
    });
  });
});

describe('createLicenseRuntime', () => {
  let tempDir: string;

  beforeEach(() => {
    ipcHandlers.clear();
    vi.resetModules();
    tempDir = mkdtempSync(path.join(tmpdir(), 'lingua-license-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function freshPayload(overrides: Partial<{ tier: string; supportWindowEndsAt: string; issuedAt: string }> = {}) {
    return {
      productId: 'lingua-desktop',
      tier: (overrides.tier ?? 'pro') as 'pro' | 'pro_lifetime' | 'team',
      issuedTo: 'user@example.com',
      issuedAt: overrides.issuedAt ?? new Date(Date.now() - 1000).toISOString(),
      supportWindowEndsAt:
        overrides.supportWindowEndsAt ?? new Date(Date.now() + 30 * 86_400_000).toISOString(),
      entitlements: ['plugins'] as const,
    };
  }

  it('boots in the free tier when nothing is persisted yet', async () => {
    const { createLicenseRuntime } = await import('../../src/main/license');
    const runtime = await createLicenseRuntime({ userDataDir: tempDir, publicKeyJwk });
    const snap = runtime.getSnapshot();
    expect(snap.token).toBeNull();
    expect(snap.status.kind).toBe('free');
    expect(snap.deviceId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('applyToken verifies a valid token, persists it, and exposes an active snapshot', async () => {
    const { createLicenseRuntime, readPersistedLicense, resolveLicensePath } = await import(
      '../../src/main/license'
    );
    const runtime = await createLicenseRuntime({ userDataDir: tempDir, publicKeyJwk });
    const token = await signLicenseTokenForTest(freshPayload(), privateKeyJwk);

    const status = await runtime.applyToken(token);
    expect(status.kind).toBe('active');

    const snap = runtime.getSnapshot();
    expect(snap.token).toBe(token);
    expect(snap.status.kind).toBe('active');
    expect(snap.lastVerifiedAt).toBeGreaterThan(0);

    const persisted = await readPersistedLicense(resolveLicensePath(tempDir));
    expect(persisted?.token).toBe(token);
  });

  it('applyToken with empty input drops to invalid + free without persisting anything', async () => {
    const { createLicenseRuntime, readPersistedLicense, resolveLicensePath } = await import(
      '../../src/main/license'
    );
    const runtime = await createLicenseRuntime({ userDataDir: tempDir, publicKeyJwk });
    const status = await runtime.applyToken('   ');
    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') expect(status.reason).toBe('malformed');
    expect(runtime.getSnapshot().token).toBeNull();
    expect(await readPersistedLicense(resolveLicensePath(tempDir))).toBeNull();
  });

  it('applyToken with a wrong-key signature is rejected and never persisted', async () => {
    const { createLicenseRuntime, readPersistedLicense, resolveLicensePath } = await import(
      '../../src/main/license'
    );
    const runtime = await createLicenseRuntime({ userDataDir: tempDir, publicKeyJwk: otherPublicKeyJwk });
    const token = await signLicenseTokenForTest(freshPayload(), privateKeyJwk);
    const status = await runtime.applyToken(token);
    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') expect(status.reason).toBe('invalid-signature');
    expect(await readPersistedLicense(resolveLicensePath(tempDir))).toBeNull();
  });

  it('applyToken preserves an existing active license when the replacement token is invalid', async () => {
    const { createLicenseRuntime, readPersistedLicense, resolveLicensePath } = await import(
      '../../src/main/license'
    );
    const runtime = await createLicenseRuntime({ userDataDir: tempDir, publicKeyJwk });
    const goodToken = await signLicenseTokenForTest(freshPayload(), privateKeyJwk);
    await runtime.applyToken(goodToken);

    const status = await runtime.applyToken('aaa.bbb');
    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') expect(status.reason).toBe('malformed');
    expect(runtime.getSnapshot().token).toBe(goodToken);
    expect(runtime.getSnapshot().status.kind).toBe('active');

    const persisted = await readPersistedLicense(resolveLicensePath(tempDir));
    expect(persisted?.token).toBe(goodToken);
  });

  it('boot wipes a persisted token that no longer verifies (stale grace window past expiry)', async () => {
    const { createLicenseRuntime, writePersistedLicense, resolveLicensePath, readPersistedLicense } =
      await import('../../src/main/license');
    const file = resolveLicensePath(tempDir);

    const expiredToken = await signLicenseTokenForTest(
      freshPayload({
        issuedAt: new Date(Date.now() - 365 * 86_400_000).toISOString(),
        supportWindowEndsAt: new Date(Date.now() - 90 * 86_400_000).toISOString(),
      }),
      privateKeyJwk
    );
    await writePersistedLicense(file, { token: expiredToken, lastVerifiedAt: Date.now() - 86_400_000 });

    const runtime = await createLicenseRuntime({ userDataDir: tempDir, publicKeyJwk });
    expect(runtime.getSnapshot().token).toBeNull();
    expect(runtime.getSnapshot().status.kind).toBe('free');
    expect(await readPersistedLicense(file)).toBeNull();
  });

  it.skipIf(process.platform === 'win32')(
    'boot still reaches the renderer when a stale token cannot be removed',
    async () => {
      const {
        createLicenseRuntime,
        loadOrCreateDeviceId,
        resolveDeviceIdPath,
        resolveLicensePath,
        writePersistedLicense,
      } = await import('../../src/main/license');
      await loadOrCreateDeviceId(resolveDeviceIdPath(tempDir));
      const file = resolveLicensePath(tempDir);
      const expiredToken = await signLicenseTokenForTest(
        freshPayload({
          issuedAt: new Date(Date.now() - 365 * 86_400_000).toISOString(),
          supportWindowEndsAt: new Date(Date.now() - 90 * 86_400_000).toISOString(),
        }),
        privateKeyJwk
      );
      await writePersistedLicense(file, { token: expiredToken, lastVerifiedAt: Date.now() - 86_400_000 });
      await chmod(tempDir, 0o500);
      try {
        const runtime = await createLicenseRuntime({ userDataDir: tempDir, publicKeyJwk });
        expect(runtime.getSnapshot().token).toBeNull();
        expect(runtime.getSnapshot().status.kind).toBe('free');
      } finally {
        await chmod(tempDir, 0o700);
      }
    }
  );

  it('clear wipes the cache and the on-disk file', async () => {
    const { createLicenseRuntime, readPersistedLicense, resolveLicensePath } = await import(
      '../../src/main/license'
    );
    const runtime = await createLicenseRuntime({ userDataDir: tempDir, publicKeyJwk });
    const token = await signLicenseTokenForTest(freshPayload(), privateKeyJwk);
    await runtime.applyToken(token);
    await runtime.clear();
    expect(runtime.getSnapshot().token).toBeNull();
    expect(runtime.getSnapshot().status.kind).toBe('free');
    expect(await readPersistedLicense(resolveLicensePath(tempDir))).toBeNull();
  });

  it('reuses the deviceId when the runtime is recreated against the same userData dir', async () => {
    const { createLicenseRuntime } = await import('../../src/main/license');
    const a = await createLicenseRuntime({ userDataDir: tempDir, publicKeyJwk });
    const b = await createLicenseRuntime({ userDataDir: tempDir, publicKeyJwk });
    expect(b.getSnapshot().deviceId).toBe(a.getSnapshot().deviceId);
  });

  // Also skipped as root (containerized CI): root bypasses the 0o500
  // directory lock, so the simulated disk failure never happens and the
  // rejects assertion cannot fire.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'applyToken propagates a disk-write failure WITHOUT mutating the cache so disk + memory stay in sync',
    async () => {
      const { createLicenseRuntime, readPersistedLicense, resolveLicensePath } = await import(
        '../../src/main/license'
      );
      const runtime = await createLicenseRuntime({ userDataDir: tempDir, publicKeyJwk });
      const goodToken = await signLicenseTokenForTest(freshPayload(), privateKeyJwk);
      await runtime.applyToken(goodToken);
      expect(runtime.getSnapshot().token).toBe(goodToken);

      // Lock the dir so the tmp-file create inside atomicWrite fails.
      await chmod(tempDir, 0o500);
      try {
        const replacement = await signLicenseTokenForTest(
          freshPayload({ supportWindowEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString() }),
          privateKeyJwk
        );
        await expect(runtime.applyToken(replacement)).rejects.toBeInstanceOf(Error);
        // Cache must still reflect the previously persisted token, not the
        // token the user just tried to apply. If this assertion ever fires,
        // the disk-before-cache invariant has regressed and the next launch
        // will resurrect the old token while the renderer thinks it is a
        // brand-new active license.
        expect(runtime.getSnapshot().token).toBe(goodToken);
        expect(runtime.getSnapshot().status.kind).toBe('active');
      } finally {
        await chmod(tempDir, 0o700);
      }

      // Disk truth survived the failed apply.
      const persisted = await readPersistedLicense(resolveLicensePath(tempDir));
      expect(persisted?.token).toBe(goodToken);
    }
  );

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'clear propagates a disk-failure WITHOUT mutating the cache so the renderer can resync to the truth',
    async () => {
      const { createLicenseRuntime, readPersistedLicense, resolveLicensePath } = await import(
        '../../src/main/license'
      );
      const runtime = await createLicenseRuntime({ userDataDir: tempDir, publicKeyJwk });
      const goodToken = await signLicenseTokenForTest(freshPayload(), privateKeyJwk);
      await runtime.applyToken(goodToken);
      await chmod(tempDir, 0o500);
      try {
        await expect(runtime.clear()).rejects.toBeInstanceOf(Error);
        // Cache must still report active because the on-disk token is
        // still there. A previous design pre-mutated the cache and then
        // observed an unlink failure; the renderer would have shown free
        // while the next launch resurrected the active license.
        expect(runtime.getSnapshot().token).toBe(goodToken);
        expect(runtime.getSnapshot().status.kind).toBe('active');
      } finally {
        await chmod(tempDir, 0o700);
      }
      const persisted = await readPersistedLicense(resolveLicensePath(tempDir));
      expect(persisted?.token).toBe(goodToken);
    }
  );

  it('revalidate flips a now-grace token from active to grace without losing persistence', async () => {
    const { createLicenseRuntime, readPersistedLicense, resolveLicensePath } = await import(
      '../../src/main/license'
    );
    let fakeNow = Date.now();
    const runtime = await createLicenseRuntime({
      userDataDir: tempDir,
      publicKeyJwk,
      now: () => fakeNow,
    });
    const supportEnd = new Date(fakeNow + 5 * 86_400_000).toISOString();
    const token = await signLicenseTokenForTest(
      freshPayload({ supportWindowEndsAt: supportEnd }),
      privateKeyJwk
    );
    const initial = await runtime.applyToken(token);
    expect(initial.kind).toBe('active');

    fakeNow += 7 * 86_400_000; // 7 days past support end, still inside default 14d grace
    const next = await runtime.revalidate();
    expect(next.kind).toBe('grace');
    expect(runtime.getSnapshot().token).toBe(token);

    const persisted = await readPersistedLicense(resolveLicensePath(tempDir));
    expect(persisted?.token).toBe(token);
  });
});

describe('registerLicenseHandlers', () => {
  let tempDir: string;

  beforeEach(() => {
    ipcHandlers.clear();
    vi.resetModules();
    tempDir = mkdtempSync(path.join(tmpdir(), 'lingua-license-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes license:get-state, license:apply-token, license:clear, license:revalidate', async () => {
    const { createLicenseRuntime } = await import('../../src/main/license');
    const { registerLicenseHandlers } = await import('../../src/main/ipc/license');
    const runtime = await createLicenseRuntime({ userDataDir: tempDir, publicKeyJwk });
    registerLicenseHandlers(runtime);

    expect(ipcHandlers.has('license:get-state')).toBe(true);
    expect(ipcHandlers.has('license:apply-token')).toBe(true);
    expect(ipcHandlers.has('license:clear')).toBe(true);
    expect(ipcHandlers.has('license:revalidate')).toBe(true);
  });

  it('license:apply-token forwards a string token through the runtime and returns the snapshot', async () => {
    const { createLicenseRuntime } = await import('../../src/main/license');
    const { registerLicenseHandlers } = await import('../../src/main/ipc/license');
    const runtime = await createLicenseRuntime({ userDataDir: tempDir, publicKeyJwk });
    registerLicenseHandlers(runtime);

    const token = await signLicenseTokenForTest(
      {
        productId: 'lingua-desktop',
        tier: 'pro',
        issuedTo: 'user@example.com',
        issuedAt: new Date(Date.now() - 1000).toISOString(),
        supportWindowEndsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        entitlements: ['plugins'],
      },
      privateKeyJwk
    );

    const handler = ipcHandlers.get('license:apply-token')!;
    const result = (await handler({}, token)) as
      | { ok: true; status: { kind: string } }
      | { ok: false };
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status.kind).toBe('active');
  });

  it('license:apply-token rejects non-string input with reason invalid-input', async () => {
    const { createLicenseRuntime } = await import('../../src/main/license');
    const { registerLicenseHandlers } = await import('../../src/main/ipc/license');
    const runtime = await createLicenseRuntime({ userDataDir: tempDir, publicKeyJwk });
    registerLicenseHandlers(runtime);

    const handler = ipcHandlers.get('license:apply-token')!;
    const result = (await handler({}, 42)) as { ok: boolean; reason?: string };
    expect(result).toEqual({ ok: false, reason: 'invalid-input', message: 'Expected a string token.' });
  });

  it('license:clear empties the snapshot', async () => {
    const { createLicenseRuntime } = await import('../../src/main/license');
    const { registerLicenseHandlers } = await import('../../src/main/ipc/license');
    const runtime = await createLicenseRuntime({ userDataDir: tempDir, publicKeyJwk });
    registerLicenseHandlers(runtime);

    const token = await signLicenseTokenForTest(
      {
        productId: 'lingua-desktop',
        tier: 'pro_lifetime',
        issuedTo: 'user@example.com',
        issuedAt: new Date(Date.now() - 1000).toISOString(),
        supportWindowEndsAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
        entitlements: ['plugins'],
      },
      privateKeyJwk
    );
    await runtime.applyToken(token);

    const clear = ipcHandlers.get('license:clear')!;
    const result = (await clear({})) as { ok: boolean };
    expect(result.ok).toBe(true);

    const get = ipcHandlers.get('license:get-state')!;
    const snapshot = (await get({})) as { token: string | null; status: { kind: string } };
    expect(snapshot.token).toBeNull();
    expect(snapshot.status.kind).toBe('free');
  });

  it('license:get-state ships the on-disk shape across the boundary (token, status, deviceId, lastVerifiedAt)', async () => {
    const { createLicenseRuntime, readPersistedLicense, resolveLicensePath } = await import(
      '../../src/main/license'
    );
    const { registerLicenseHandlers } = await import('../../src/main/ipc/license');
    const runtime = await createLicenseRuntime({ userDataDir: tempDir, publicKeyJwk });
    registerLicenseHandlers(runtime);

    const get = ipcHandlers.get('license:get-state')!;
    const initial = (await get({})) as { token: null; status: { kind: string }; deviceId: string };
    expect(initial.token).toBeNull();
    expect(initial.status.kind).toBe('free');
    expect(typeof initial.deviceId).toBe('string');

    // The snapshot is JSON-serializable end-to-end — ensure no surprise
    // (Uint8Array, function) leaks through that would crash the IPC bridge.
    expect(JSON.parse(JSON.stringify(initial))).toEqual(initial);

    // Sanity: the file shape persisted by main matches what we expect to
    // write across runs.
    const persistedFile = resolveLicensePath(tempDir);
    const onDisk = await readPersistedLicense(persistedFile);
    expect(onDisk).toBeNull();
  });
});

/**
 * RL-061 Slice 3.5 — server-aware desktop runtime.
 *
 * The base `createLicenseRuntime` block above keeps
 * `LINGUA_LICENSE_SERVER_URL` unset so the runtime stays in
 * local-verify-only mode (matches the pre-Slice-3.5 contract). This
 * block opts the runtime into the server path by setting the env var
 * before each test, then mocks `fetch` per-case to drive each
 * applyToken / revalidate / removeDevice / clear branch the plan
 * calls out.
 */
describe('createLicenseRuntime — server-aware desktop branch (Slice 3.5)', () => {
  const SERVER_URL = 'https://licenses.test.local';
  let tempDir: string;

  function freshPayload(overrides: Partial<{ tier: string; supportWindowEndsAt: string; issuedAt: string }> = {}) {
    return {
      productId: 'lingua-desktop',
      tier: (overrides.tier ?? 'pro') as 'pro' | 'pro_lifetime' | 'team',
      issuedTo: 'user@example.com',
      issuedAt: overrides.issuedAt ?? new Date(Date.now() - 1000).toISOString(),
      supportWindowEndsAt:
        overrides.supportWindowEndsAt ?? new Date(Date.now() + 30 * 86_400_000).toISOString(),
      entitlements: ['plugins'] as const,
    };
  }

  function makeFetchMock() {
    const fetchMock = vi.fn() as ReturnType<typeof vi.fn>;
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  beforeEach(() => {
    ipcHandlers.clear();
    vi.resetModules();
    tempDir = mkdtempSync(path.join(tmpdir(), 'lingua-license-'));
    process.env.LINGUA_LICENSE_SERVER_URL = SERVER_URL;
  });

  afterEach(() => {
    delete process.env.LINGUA_LICENSE_SERVER_URL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('applyToken activates against the server after local verify and caches devices + deviceLimit', async () => {
    const desktopDevice = {
      id: 'dev_d1',
      deviceId: 'd-uuid',
      deviceName: 'MacBook Pro',
      os: 'darwin',
      surface: 'desktop' as const,
      activatedAt: 1_700_000_000,
      lastSeenAt: 1_700_000_900,
    };
    const fetchMock = makeFetchMock();
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        licenseId: 'lic_1',
        activated: true,
        idempotent: false,
        devices: { desktop: [desktopDevice], web: [] },
        deviceLimit: { desktop: 3, web: 3 },
      })
    );

    const { createLicenseRuntime } = await import('../../src/main/license');
    const runtime = await createLicenseRuntime({
      userDataDir: tempDir,
      publicKeyJwk,
      deviceMetadata: { deviceName: 'MacBook Pro', os: 'darwin' },
    });
    const token = await signLicenseTokenForTest(freshPayload(), privateKeyJwk);
    const status = await runtime.applyToken(token);

    expect(status.kind).toBe('active');
    const snap = runtime.getSnapshot();
    expect(snap.serverSync).toBe('synced');
    expect(snap.devices?.desktop).toEqual([desktopDevice]);
    expect(snap.deviceLimit).toEqual({ desktop: 3, web: 3 });

    // Confirm the activate body had surface=desktop + the right device metadata.
    const activateCalls = fetchMock.mock.calls.filter(
      ([url]) => url === `${SERVER_URL}/licenses/activate`
    );
    expect(activateCalls.length).toBe(1);
    const body = JSON.parse(activateCalls[0]![1]?.body as string);
    expect(body).toMatchObject({
      surface: 'desktop',
      deviceName: 'MacBook Pro',
      os: 'darwin',
    });
  });

  it('applyToken transient failure keeps the locally-verified status with serverSync unreachable', async () => {
    const fetchMock = makeFetchMock();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const { createLicenseRuntime } = await import('../../src/main/license');
    const runtime = await createLicenseRuntime({
      userDataDir: tempDir,
      publicKeyJwk,
      deviceMetadata: { deviceName: 'host', os: 'darwin' },
    });
    const token = await signLicenseTokenForTest(freshPayload(), privateKeyJwk);
    const status = await runtime.applyToken(token);

    expect(status.kind).toBe('active');
    const snap = runtime.getSnapshot();
    expect(snap.token).toBe(token);
    expect(snap.serverSync).toBe('unreachable');
    expect(snap.devices).toBeNull();
  });

  it('applyToken exhausted preserves the token, caches the bucket, and flips status to invalid:devices-exhausted', async () => {
    const exhaustedDevices = ['a', 'b', 'c'].map((id) => ({
      id: `dev_${id}`,
      deviceId: `d-uuid-${id}`,
      deviceName: `Mac ${id}`,
      os: 'darwin',
      surface: 'desktop' as const,
      activatedAt: 1_700_000_000,
      lastSeenAt: 1_700_000_900,
    }));
    const fetchMock = makeFetchMock();
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: false,
        reason: 'exhausted',
        surface: 'desktop',
        devices: { desktop: exhaustedDevices, web: [] },
        deviceLimit: { desktop: 3, web: 3 },
      })
    );

    const { createLicenseRuntime } = await import('../../src/main/license');
    const runtime = await createLicenseRuntime({
      userDataDir: tempDir,
      publicKeyJwk,
      deviceMetadata: { deviceName: 'host', os: 'darwin' },
    });
    const token = await signLicenseTokenForTest(freshPayload(), privateKeyJwk);
    const status = await runtime.applyToken(token);

    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') expect(status.reason).toBe('devices-exhausted');
    const snap = runtime.getSnapshot();
    expect(snap.token).toBe(token);
    expect(snap.devices?.desktop).toEqual(exhaustedDevices);
  });

  it('revalidate with deviceRegistered=false re-activates so a rehydrated exhausted token cannot bypass the cap', async () => {
    let activateCalls = 0;
    const registeredDevice = {
      id: 'dev_reg',
      deviceId: 'd-uuid',
      deviceName: 'host',
      os: 'darwin',
      surface: 'desktop' as const,
      activatedAt: 1_700_001_000,
      lastSeenAt: 1_700_001_500,
    };
    const fetchMock = makeFetchMock();
    fetchMock.mockImplementation(async (url: Parameters<typeof fetch>[0]) => {
      const requestUrl = String(url);
      if (requestUrl === `${SERVER_URL}/licenses/activate`) {
        activateCalls += 1;
        return jsonResponse({
          ok: true,
          licenseId: 'lic_1',
          activated: true,
          idempotent: activateCalls > 1,
          devices: { desktop: activateCalls > 1 ? [registeredDevice] : [], web: [] },
          deviceLimit: { desktop: 3, web: 3 },
        });
      }
      // status — pretend the device fell off the bucket
      return jsonResponse({
        ok: true,
        licenseId: 'lic_1',
        status: 'active',
        tier: 'pro',
        expiresAt: null,
        supportWindowEndsAt: Math.floor(Date.now() / 1000) + 90 * 86_400,
        devices: { desktop: [], web: [] },
        deviceLimit: { desktop: 3, web: 3 },
        deviceRegistered: false,
      });
    });

    const { createLicenseRuntime } = await import('../../src/main/license');
    const runtime = await createLicenseRuntime({
      userDataDir: tempDir,
      publicKeyJwk,
      deviceMetadata: { deviceName: 'host', os: 'darwin' },
    });
    const token = await signLicenseTokenForTest(freshPayload(), privateKeyJwk);
    await runtime.applyToken(token);
    const status = await runtime.revalidate();

    expect(status.kind).toBe('active');
    expect(activateCalls).toBe(2);
    const snap = runtime.getSnapshot();
    expect(snap.devices?.desktop).toEqual([registeredDevice]);
  });

  it('revalidate treats server-side expired status as authoritative over a locally valid token', async () => {
    const fetchMock = makeFetchMock();
    fetchMock.mockImplementation(async (url: Parameters<typeof fetch>[0]) => {
      const requestUrl = String(url);
      if (requestUrl === `${SERVER_URL}/licenses/activate`) {
        return jsonResponse({
          ok: true,
          licenseId: 'lic_1',
          activated: true,
          idempotent: false,
          devices: { desktop: [], web: [] },
          deviceLimit: { desktop: 3, web: 3 },
        });
      }
      return jsonResponse({
        ok: true,
        licenseId: 'lic_1',
        status: 'expired',
        tier: 'pro',
        expiresAt: Math.floor(Date.now() / 1000) - 60,
        supportWindowEndsAt: Math.floor(Date.now() / 1000) - 60,
        devices: { desktop: [], web: [] },
        deviceLimit: { desktop: 3, web: 3 },
        deviceRegistered: true,
      });
    });

    const { createLicenseRuntime } = await import('../../src/main/license');
    const runtime = await createLicenseRuntime({
      userDataDir: tempDir,
      publicKeyJwk,
      deviceMetadata: { deviceName: 'host', os: 'darwin' },
    });
    const token = await signLicenseTokenForTest(freshPayload(), privateKeyJwk);
    await runtime.applyToken(token);

    const status = await runtime.revalidate();

    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') expect(status.reason).toBe('expired');
    const snap = runtime.getSnapshot();
    expect(snap.token).toBeNull();
    expect(snap.devices).toBeNull();
  });

  it('revalidate updates the verification payload when accepting a newer refreshedToken', async () => {
    const oldIssuedAt = new Date(Date.now() - 10_000).toISOString();
    const newIssuedAt = new Date(Date.now() + 10_000).toISOString();
    const oldToken = await signLicenseTokenForTest(
      freshPayload({ issuedAt: oldIssuedAt, tier: 'pro' }),
      privateKeyJwk
    );
    const refreshedToken = await signLicenseTokenForTest(
      freshPayload({ issuedAt: newIssuedAt, tier: 'team' }),
      privateKeyJwk
    );
    const fetchMock = makeFetchMock();
    fetchMock.mockImplementation(async (url: Parameters<typeof fetch>[0]) => {
      const requestUrl = String(url);
      if (requestUrl === `${SERVER_URL}/licenses/activate`) {
        return jsonResponse({
          ok: true,
          licenseId: 'lic_1',
          activated: true,
          idempotent: false,
          devices: { desktop: [], web: [] },
          deviceLimit: { desktop: 3, web: 3 },
        });
      }
      return jsonResponse({
        ok: true,
        licenseId: 'lic_1',
        status: 'active',
        tier: 'team',
        expiresAt: null,
        supportWindowEndsAt: Math.floor(Date.now() / 1000) + 90 * 86_400,
        devices: { desktop: [], web: [] },
        deviceLimit: { desktop: 3, web: 3 },
        deviceRegistered: true,
        refreshedToken,
      });
    });

    const { createLicenseRuntime } = await import('../../src/main/license');
    const runtime = await createLicenseRuntime({
      userDataDir: tempDir,
      publicKeyJwk,
      deviceMetadata: { deviceName: 'host', os: 'darwin' },
    });
    await runtime.applyToken(oldToken);

    const status = await runtime.revalidate();

    expect(status.kind).toBe('active');
    if (status.kind === 'active') expect(status.verification.payload.tier).toBe('team');
    const snap = runtime.getSnapshot();
    expect(snap.token).toBe(refreshedToken);
    if (snap.status.kind === 'active') expect(snap.status.verification.payload.tier).toBe('team');
  });

  it('removeDevice POSTs to /licenses/devices/remove and refreshes the cached bucket on success', async () => {
    const fetchMock = makeFetchMock();
    let activateDone = false;
    fetchMock.mockImplementation(async (url: Parameters<typeof fetch>[0]) => {
      const requestUrl = String(url);
      if (requestUrl === `${SERVER_URL}/licenses/activate`) {
        activateDone = true;
        return jsonResponse({
          ok: true,
          licenseId: 'lic_1',
          activated: true,
          idempotent: false,
          devices: {
            desktop: [
              { id: 'd1', deviceId: 'd-uuid', deviceName: 'host', os: 'darwin', surface: 'desktop', activatedAt: 1, lastSeenAt: 2 },
              { id: 'd2', deviceId: 'd-other', deviceName: 'other', os: 'darwin', surface: 'desktop', activatedAt: 1, lastSeenAt: 2 },
            ],
            web: [],
          },
          deviceLimit: { desktop: 3, web: 3 },
        });
      }
      // remove
      expect(activateDone).toBe(true);
      return jsonResponse({
        ok: true,
        licenseId: 'lic_1',
        removed: true,
        devices: {
          desktop: [
            { id: 'd1', deviceId: 'd-uuid', deviceName: 'host', os: 'darwin', surface: 'desktop', activatedAt: 1, lastSeenAt: 2 },
          ],
          web: [],
        },
        deviceLimit: { desktop: 3, web: 3 },
      });
    });

    const { createLicenseRuntime } = await import('../../src/main/license');
    const runtime = await createLicenseRuntime({
      userDataDir: tempDir,
      publicKeyJwk,
      deviceMetadata: { deviceName: 'host', os: 'darwin' },
    });
    const token = await signLicenseTokenForTest(freshPayload(), privateKeyJwk);
    await runtime.applyToken(token);
    expect(runtime.getSnapshot().devices?.desktop.length).toBe(2);

    const result = await runtime.removeDevice('d-other');
    expect(result.ok).toBe(true);
    expect(runtime.getSnapshot().devices?.desktop.length).toBe(1);

    const removeCalls = fetchMock.mock.calls.filter(
      ([url]) => url === `${SERVER_URL}/licenses/devices/remove`
    );
    expect(removeCalls.length).toBe(1);
    const body = JSON.parse(removeCalls[0]![1]?.body as string);
    expect(body).toEqual({ token, deviceIdToRemove: 'd-other' });
  });

  it('removeDevice unreachable preserves the cached bucket and forwards the failure shape', async () => {
    const fetchMock = makeFetchMock();
    let stage = 'activate';
    fetchMock.mockImplementation(async (url: Parameters<typeof fetch>[0]) => {
      const requestUrl = String(url);
      if (requestUrl === `${SERVER_URL}/licenses/activate`) {
        stage = 'remove';
        return jsonResponse({
          ok: true,
          licenseId: 'lic_1',
          activated: true,
          idempotent: false,
          devices: {
            desktop: [
              { id: 'd1', deviceId: 'd-uuid', deviceName: 'host', os: 'darwin', surface: 'desktop', activatedAt: 1, lastSeenAt: 2 },
            ],
            web: [],
          },
          deviceLimit: { desktop: 3, web: 3 },
        });
      }
      expect(stage).toBe('remove');
      throw new TypeError('Failed to fetch');
    });

    const { createLicenseRuntime } = await import('../../src/main/license');
    const runtime = await createLicenseRuntime({
      userDataDir: tempDir,
      publicKeyJwk,
      deviceMetadata: { deviceName: 'host', os: 'darwin' },
    });
    const token = await signLicenseTokenForTest(freshPayload(), privateKeyJwk);
    await runtime.applyToken(token);
    const before = runtime.getSnapshot().devices?.desktop;

    const result = await runtime.removeDevice('d-uuid');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unreachable');
    expect(runtime.getSnapshot().devices?.desktop).toEqual(before);
  });

  it('clear best-effort fires removeDevice for the current device and wipes the cache regardless of result', async () => {
    const fetchMock = makeFetchMock();
    let stage = 'activate';
    fetchMock.mockImplementation(async (url: Parameters<typeof fetch>[0]) => {
      const requestUrl = String(url);
      if (requestUrl === `${SERVER_URL}/licenses/activate`) {
        stage = 'remove';
        return jsonResponse({
          ok: true,
          licenseId: 'lic_1',
          activated: true,
          idempotent: false,
          devices: { desktop: [], web: [] },
          deviceLimit: { desktop: 3, web: 3 },
        });
      }
      expect(stage).toBe('remove');
      // Fail the remove — clear should still wipe local state.
      throw new TypeError('Failed to fetch');
    });

    const { createLicenseRuntime } = await import('../../src/main/license');
    const runtime = await createLicenseRuntime({
      userDataDir: tempDir,
      publicKeyJwk,
      deviceMetadata: { deviceName: 'host', os: 'darwin' },
    });
    const token = await signLicenseTokenForTest(freshPayload(), privateKeyJwk);
    await runtime.applyToken(token);
    expect(runtime.getSnapshot().token).toBe(token);

    await runtime.clear();
    const snap = runtime.getSnapshot();
    expect(snap.token).toBeNull();
    expect(snap.status.kind).toBe('free');
    expect(snap.devices).toBeNull();

    const removeCalls = fetchMock.mock.calls.filter(
      ([url]) => url === `${SERVER_URL}/licenses/devices/remove`
    );
    expect(removeCalls.length).toBe(1);
  });

  it('clear does not wait for the best-effort server device removal to settle', async () => {
    const fetchMock = makeFetchMock();
    let stage = 'activate';
    let resolveRemove!: (response: Response) => void;
    const pendingRemove = new Promise<Response>((resolve) => {
      resolveRemove = resolve;
    });
    fetchMock.mockImplementation(async (url: Parameters<typeof fetch>[0]) => {
      const requestUrl = String(url);
      if (requestUrl === `${SERVER_URL}/licenses/activate`) {
        stage = 'remove';
        return jsonResponse({
          ok: true,
          licenseId: 'lic_1',
          activated: true,
          idempotent: false,
          devices: { desktop: [], web: [] },
          deviceLimit: { desktop: 3, web: 3 },
        });
      }
      expect(stage).toBe('remove');
      return pendingRemove;
    });

    const { createLicenseRuntime } = await import('../../src/main/license');
    const runtime = await createLicenseRuntime({
      userDataDir: tempDir,
      publicKeyJwk,
      deviceMetadata: { deviceName: 'host', os: 'darwin' },
    });
    const token = await signLicenseTokenForTest(freshPayload(), privateKeyJwk);
    await runtime.applyToken(token);

    let clearResolved = false;
    const clearPromise = runtime.clear().then(() => {
      clearResolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(clearResolved).toBe(true);
    resolveRemove(
      jsonResponse({
        ok: true,
        licenseId: 'lic_1',
        removed: true,
        devices: { desktop: [], web: [] },
        deviceLimit: { desktop: 3, web: 3 },
      })
    );
    await clearPromise;
    expect(runtime.getSnapshot().token).toBeNull();
    const removeCalls = fetchMock.mock.calls.filter(
      ([url]) => url === `${SERVER_URL}/licenses/devices/remove`
    );
    expect(removeCalls.length).toBe(1);
  });
});
