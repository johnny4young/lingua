/**
 * Tiny in-memory D1 mock + env factory for license-server tests.
 *
 * Why hand-rolled (no better-sqlite3, no miniflare): vitest-pool-workers
 * requires vitest 4.x which the parent repo isn't on yet, and
 * better-sqlite3 needs native compilation. The tests we run here only
 * need three SQL shapes (INSERT, SELECT one, UPDATE) so a 100-line
 * Map-backed double covers everything implementation exercises.
 *
 * The mock is permissive: it does NOT enforce CHECK constraints or
 * UNIQUE indexes. Tests that need to verify those constraints belong
 * in a future miniflare integration tier (flagged as MED follow-up).
 *
 * The schema is hard-coded to the minimum the handlers query — adding
 * a column means updating both the migration .sql AND the row shapes
 * here, which is intentional friction so the schema stays in sync
 * with the docs.
 */

import { vi } from 'vitest';
import type { Env } from '../src/index';

interface LicenseRow {
  id: string;
  token: string;
  product_id: string;
  tier: string;
  device_limit: number;
  issued_to: string;
  issued_at: number;
  expires_at: number | null;
  support_window_ends_at: number | null;
  status: string;
  merchant_order_id: string | null;
  merchant_subscription_id: string | null;
  created_at: number;
  updated_at: number;
}

interface DeviceRow {
  id: string;
  license_id: string;
  device_id: string;
  device_name: string;
  os: string;
  surface: string;
  activated_at: number;
  last_seen_at: number;
  removed_at: number | null;
}

interface TrialRow {
  id: string;
  email: string;
  device_id: string;
  license_id: string;
  issued_at: number;
}

interface EducationRow {
  id: string;
  email: string;
  device_id: string;
  license_id: string;
  issued_at: number;
}

interface PendingConfirmationRow {
  id: string;
  email: string;
  device_id: string | null;
  device_name: string | null;
  os: string | null;
  created_at: number;
  expires_at: number;
  confirmed_at: number | null;
}

function recoveryTierPriority(tier: string): number {
  if (tier === 'pro' || tier === 'pro_lifetime' || tier === 'team') return 0;
  if (tier === 'education') return 1;
  if (tier === 'trial') return 2;
  return 3;
}

class MockD1Database {
  licenses = new Map<string, LicenseRow>();
  devices = new Map<string, DeviceRow>();
  // implementation — internal
  trials = new Map<string, TrialRow>();
  educations = new Map<string, EducationRow>();
  educationPending = new Map<string, PendingConfirmationRow>();
  recoveryPending = new Map<string, PendingConfirmationRow>();

  prepare(query: string): MockStatement {
    return new MockStatement(this, query);
  }
}

class MockStatement {
  private boundParams: unknown[] = [];

  constructor(private readonly db: MockD1Database, private readonly query: string) {}

  bind(...params: unknown[]): MockStatement {
    this.boundParams = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    const rows = this.execute();
    return (rows[0] as T) ?? null;
  }

  async all<T>(): Promise<{ results: T[]; meta?: Record<string, unknown> }> {
    return { results: this.execute() as T[], meta: { changes: 0 } };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const changes = this.executeMutation();
    return { meta: { changes } };
  }

  // ---- Routing the SQL string into the right code path ----

  private execute(): unknown[] {
    const q = this.query.trim().replace(/\s+/g, ' ');

    if (q.startsWith('SELECT * FROM licenses WHERE token =')) {
      const [token] = this.boundParams as [string];
      const row = [...this.db.licenses.values()].find((r) => r.token === token);
      return row ? [row] : [];
    }
    if (q.startsWith('SELECT * FROM licenses WHERE id =')) {
      const [id] = this.boundParams as [string];
      const row = this.db.licenses.get(id);
      return row ? [row] : [];
    }
    if (q.startsWith('SELECT * FROM licenses WHERE merchant_subscription_id =')) {
      const [subscriptionId] = this.boundParams as [string];
      const row = [...this.db.licenses.values()].find(
        (r) => r.merchant_subscription_id === subscriptionId
      );
      return row ? [row] : [];
    }
    if (q.startsWith('SELECT * FROM licenses WHERE merchant_order_id =')) {
      const [orderId] = this.boundParams as [string];
      const row = [...this.db.licenses.values()].find((r) => r.merchant_order_id === orderId);
      return row ? [row] : [];
    }
    if (q.startsWith('SELECT * FROM devices WHERE license_id = ? AND device_id = ? AND surface =')) {
      const [licenseId, deviceId, surface] = this.boundParams as [string, string, string];
      const row = [...this.db.devices.values()].find(
        (r) =>
          r.license_id === licenseId && r.device_id === deviceId && r.surface === surface
      );
      return row ? [row] : [];
    }
    if (
      q.startsWith(
        'SELECT * FROM devices WHERE license_id = ? AND surface = ? AND removed_at IS NULL'
      )
    ) {
      const [licenseId, surface] = this.boundParams as [string, string];
      return [...this.db.devices.values()]
        .filter(
          (r) =>
            r.license_id === licenseId && r.surface === surface && r.removed_at === null
        )
        .sort((a, b) => a.activated_at - b.activated_at);
    }
    if (q.startsWith('SELECT * FROM devices WHERE license_id = ? AND removed_at IS NULL')) {
      const [licenseId] = this.boundParams as [string];
      return [...this.db.devices.values()]
        .filter((r) => r.license_id === licenseId && r.removed_at === null)
        .sort((a, b) =>
          a.surface !== b.surface ? a.surface.localeCompare(b.surface) : a.activated_at - b.activated_at
        );
    }
    if (q.startsWith('SELECT COUNT(*) AS n FROM devices')) {
      const [licenseId, surface] = this.boundParams as [string, string];
      const count = [...this.db.devices.values()].filter(
        (r) => r.license_id === licenseId && r.surface === surface && r.removed_at === null
      ).length;
      return [{ n: count }];
    }
    // ------- implementation — trials / educations / pending tables / email lookup
    if (q.startsWith('SELECT * FROM trials WHERE email =')) {
      const [email] = this.boundParams as [string];
      const row = [...this.db.trials.values()].find((r) => r.email === email);
      return row ? [row] : [];
    }
    if (q.startsWith('SELECT * FROM trials WHERE device_id =')) {
      const [deviceId] = this.boundParams as [string];
      const row = [...this.db.trials.values()].find((r) => r.device_id === deviceId);
      return row ? [row] : [];
    }
    if (q.startsWith('SELECT * FROM educations WHERE email =')) {
      const [email] = this.boundParams as [string];
      const row = [...this.db.educations.values()].find((r) => r.email === email);
      return row ? [row] : [];
    }
    if (q.startsWith('SELECT * FROM educations WHERE device_id =')) {
      const [deviceId] = this.boundParams as [string];
      const row = [...this.db.educations.values()].find((r) => r.device_id === deviceId);
      return row ? [row] : [];
    }
    if (q.startsWith('SELECT * FROM education_pending_confirmations WHERE id =')) {
      const [id] = this.boundParams as [string];
      const row = this.db.educationPending.get(id);
      return row ? [row] : [];
    }
    if (q.startsWith('SELECT * FROM recovery_pending_confirmations WHERE id =')) {
      const [id] = this.boundParams as [string];
      const row = this.db.recoveryPending.get(id);
      return row ? [row] : [];
    }
    if (q.startsWith('SELECT * FROM licenses WHERE issued_to =')) {
      const [email] = this.boundParams as [string];
      const matches = [...this.db.licenses.values()].filter((r) => r.issued_to === email);
      matches.sort((a, b) => {
        const priorityDelta = recoveryTierPriority(a.tier) - recoveryTierPriority(b.tier);
        return priorityDelta !== 0 ? priorityDelta : b.created_at - a.created_at;
      });
      return matches.length > 0 && matches[0] ? [matches[0]] : [];
    }
    return [];
  }

  private executeMutation(): number {
    const q = this.query.trim().replace(/\s+/g, ' ');

    if (q.startsWith('INSERT INTO licenses')) {
      const [
        id,
        token,
        product_id,
        tier,
        device_limit,
        issued_to,
        issued_at,
        expires_at,
        support_window_ends_at,
        status,
        merchant_order_id,
        merchant_subscription_id,
        created_at,
        updated_at,
      ] = this.boundParams as [
        string,
        string,
        string,
        string,
        number,
        string,
        number,
        number | null,
        number | null,
        string,
        string | null,
        string | null,
        number,
        number,
      ];
      this.db.licenses.set(id, {
        id,
        token,
        product_id,
        tier,
        device_limit,
        issued_to,
        issued_at,
        expires_at,
        support_window_ends_at,
        status,
        merchant_order_id,
        merchant_subscription_id,
        created_at,
        updated_at,
      });
      return 1;
    }
    if (
      q.startsWith(
        "UPDATE licenses SET token = ?, updated_at = ? WHERE id = ? AND token = ? AND status NOT IN"
      )
    ) {
      const [token, updatedAt, id, expectedToken] = this.boundParams as [
        string,
        number,
        string,
        string,
      ];
      const row = this.db.licenses.get(id);
      if (
        !row ||
        row.token !== expectedToken ||
        row.status === 'refunded' ||
        row.status === 'expired'
      ) {
        return 0;
      }
      row.token = token;
      row.updated_at = updatedAt;
      return 1;
    }
    if (q.startsWith('UPDATE licenses SET token =')) {
      const [token, expiresAt, supportWindowEndsAt, updatedAt, id] = this.boundParams as [
        string,
        number | null,
        number | null,
        number,
        string,
      ];
      const row = this.db.licenses.get(id);
      if (!row) return 0;
      row.token = token;
      row.expires_at = expiresAt;
      row.support_window_ends_at = supportWindowEndsAt;
      row.status = 'active';
      row.updated_at = updatedAt;
      return 1;
    }
    if (q.startsWith('UPDATE licenses SET status =')) {
      const [status, updatedAt, id] = this.boundParams as [string, number, string];
      const row = this.db.licenses.get(id);
      if (!row) return 0;
      row.status = status;
      row.updated_at = updatedAt;
      return 1;
    }
    if (q.startsWith('INSERT INTO devices') && q.includes('SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL')) {
      const [
        id,
        license_id,
        device_id,
        device_name,
        os,
        surface,
        activated_at,
        last_seen_at,
        countLicenseId,
        countSurface,
        deviceLimit,
        existsLicenseId,
        existsDeviceId,
        existsSurface,
      ] = this.boundParams as [
        string,
        string,
        string,
        string,
        string,
        string,
        number,
        number,
        string,
        string,
        number,
        string,
        string,
        string,
      ];
      const activeCount = [...this.db.devices.values()].filter(
        (row) =>
          row.license_id === countLicenseId &&
          row.surface === countSurface &&
          row.removed_at === null
      ).length;
      const activeDuplicate = [...this.db.devices.values()].some(
        (row) =>
          row.license_id === existsLicenseId &&
          row.device_id === existsDeviceId &&
          row.surface === existsSurface &&
          row.removed_at === null
      );
      if (activeCount >= deviceLimit || activeDuplicate) return 0;
      this.db.devices.set(id, {
        id,
        license_id,
        device_id,
        device_name,
        os,
        surface,
        activated_at,
        last_seen_at,
        removed_at: null,
      });
      return 1;
    }
    if (q.startsWith('INSERT INTO devices')) {
      const [
        id,
        license_id,
        device_id,
        device_name,
        os,
        surface,
        activated_at,
        last_seen_at,
      ] = this.boundParams as [
        string,
        string,
        string,
        string,
        string,
        string,
        number,
        number,
      ];
      this.db.devices.set(id, {
        id,
        license_id,
        device_id,
        device_name,
        os,
        surface,
        activated_at,
        last_seen_at,
        removed_at: null,
      });
      return 1;
    }
    if (
      q.startsWith('UPDATE devices SET removed_at = NULL') &&
      q.includes('removed_at IS NOT NULL')
    ) {
      const [lastSeenAt, deviceName, os, id, licenseId, surface, deviceLimit] =
        this.boundParams as [number, string, string, string, string, string, number];
      const row = this.db.devices.get(id);
      if (!row || row.removed_at === null) return 0;
      const activeCount = [...this.db.devices.values()].filter(
        (candidate) =>
          candidate.license_id === licenseId &&
          candidate.surface === surface &&
          candidate.removed_at === null
      ).length;
      if (activeCount >= deviceLimit) return 0;
      row.removed_at = null;
      row.last_seen_at = lastSeenAt;
      row.device_name = deviceName;
      row.os = os;
      return 1;
    }
    if (q.startsWith('UPDATE devices SET removed_at = NULL')) {
      const [lastSeenAt, deviceName, os, id] = this.boundParams as [number, string, string, string];
      const row = this.db.devices.get(id);
      if (!row) return 0;
      row.removed_at = null;
      row.last_seen_at = lastSeenAt;
      row.device_name = deviceName;
      row.os = os;
      return 1;
    }
    if (q.startsWith('UPDATE devices SET last_seen_at = ? WHERE id =')) {
      const [lastSeenAt, id] = this.boundParams as [number, string];
      const row = this.db.devices.get(id);
      if (!row) return 0;
      row.last_seen_at = lastSeenAt;
      return 1;
    }
    if (q.startsWith('UPDATE devices SET removed_at = ?')) {
      const [removedAt, licenseId, deviceId] = this.boundParams as [number, string, string];
      let changes = 0;
      for (const row of this.db.devices.values()) {
        if (row.license_id === licenseId && row.device_id === deviceId && row.removed_at === null) {
          row.removed_at = removedAt;
          changes += 1;
        }
      }
      return changes;
    }
    // ------------------------------------------ implementation — internal inserts
    if (q.startsWith('INSERT INTO trials')) {
      const [id, email, device_id, license_id, issued_at] = this.boundParams as [
        string,
        string,
        string,
        string,
        number,
      ];
      // SQL UNIQUE constraint emulation — throw the same shape D1
      // does so the handler's pre-check + INSERT-collision behaviour
      // matches production.
      for (const r of this.db.trials.values()) {
        if (r.email === email) throw new Error('UNIQUE constraint failed: trials.email');
        if (r.device_id === device_id) throw new Error('UNIQUE constraint failed: trials.device_id');
      }
      this.db.trials.set(id, { id, email, device_id, license_id, issued_at });
      return 1;
    }
    if (q.startsWith('INSERT INTO educations')) {
      const [id, email, device_id, license_id, issued_at] = this.boundParams as [
        string,
        string,
        string,
        string,
        number,
      ];
      for (const r of this.db.educations.values()) {
        if (r.email === email) throw new Error('UNIQUE constraint failed: educations.email');
        if (r.device_id === device_id) throw new Error('UNIQUE constraint failed: educations.device_id');
      }
      this.db.educations.set(id, { id, email, device_id, license_id, issued_at });
      return 1;
    }
    if (q.startsWith('INSERT INTO education_pending_confirmations')) {
      const [id, email, device_id, device_name, os, created_at, expires_at] = this.boundParams as [
        string,
        string,
        string,
        string,
        string,
        number,
        number,
      ];
      this.db.educationPending.set(id, {
        id,
        email,
        device_id,
        device_name,
        os,
        created_at,
        expires_at,
        confirmed_at: null,
      });
      return 1;
    }
    if (q.startsWith('UPDATE education_pending_confirmations SET confirmed_at =')) {
      const [confirmedAt, id] = this.boundParams as [number, string];
      const row = this.db.educationPending.get(id);
      if (!row || row.confirmed_at !== null) return 0;
      row.confirmed_at = confirmedAt;
      return 1;
    }
    if (q.startsWith('INSERT INTO recovery_pending_confirmations')) {
      const [id, email, created_at, expires_at] = this.boundParams as [
        string,
        string,
        number,
        number,
      ];
      this.db.recoveryPending.set(id, {
        id,
        email,
        device_id: null,
        device_name: null,
        os: null,
        created_at,
        expires_at,
        confirmed_at: null,
      });
      return 1;
    }
    if (q.startsWith('UPDATE recovery_pending_confirmations SET confirmed_at =')) {
      const [confirmedAt, id] = this.boundParams as [number, string];
      const row = this.db.recoveryPending.get(id);
      if (!row || row.confirmed_at !== null) return 0;
      row.confirmed_at = confirmedAt;
      return 1;
    }
    return 0;
  }
}

export function createMockD1(): MockD1Database {
  return new MockD1Database();
}

export function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

export interface MockEnvOptions {
  lsWebhookSecret?: string;
  lsStoreId?: string;
  lsVariantMonthly?: string;
  lsVariantLifetime?: string;
  lsVariantTeam?: string;
  privateKeyJwk?: JsonWebKey;
  nextPrivateKeyJwk?: JsonWebKey;
  signingKeySlot?: 'current' | 'next';
  publicKeyJwk?: JsonWebKey;
  publicKeyring?: readonly JsonWebKey[];
  resendApiKey?: string;
  corsAllowedOrigins?: string;
}

export function createMockEnv(options: MockEnvOptions = {}): Env & { __db: MockD1Database } {
  const db = createMockD1();
  return {
    DB: db as unknown as D1Database,
    RATE_LIMIT: createMockKV(),
    LS_WEBHOOK_SECRET: options.lsWebhookSecret ?? '',
    LS_API_KEY: 'lsk_mock',
    LS_STORE_ID: options.lsStoreId ?? '',
    LS_VARIANT_MONTHLY: options.lsVariantMonthly ?? '111',
    LS_VARIANT_LIFETIME: options.lsVariantLifetime ?? '222',
    LS_VARIANT_TEAM: options.lsVariantTeam ?? '333',
    LINGUA_LICENSE_PRIVATE_KEY_JWK: options.privateKeyJwk ? JSON.stringify(options.privateKeyJwk) : '',
    LINGUA_LICENSE_NEXT_PRIVATE_KEY_JWK: options.nextPrivateKeyJwk
      ? JSON.stringify(options.nextPrivateKeyJwk)
      : '',
    LINGUA_LICENSE_SIGNING_KEY_SLOT: options.signingKeySlot ?? 'current',
    LINGUA_LICENSE_PUBLIC_KEY_JWK: options.publicKeyring
      ? JSON.stringify(options.publicKeyring)
      : options.publicKeyJwk ? JSON.stringify(options.publicKeyJwk) : '',
    RESEND_API_KEY: options.resendApiKey ?? '',
    RESEND_FROM_EMAIL: 'noreply@linguacode.dev',
    RESEND_FROM_NAME: 'Lingua',
    CORS_ALLOWED_ORIGINS: options.corsAllowedOrigins ?? 'https://linguacode.dev',
    __db: db,
  };
}

export async function generateEd25519Keypair(): Promise<{
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;
  // `exportKey('jwk', ...)` returns `JsonWebKey` per the spec, but the
  // workers-types declarations widen it to `ArrayBuffer | JsonWebKey`
  // because the same overload covers `'raw'`. The format=jwk branch is
  // always the JsonWebKey arm, hence the cast.
  return {
    publicKeyJwk: (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey,
    privateKeyJwk: (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey,
  };
}


/**
 * Build a Lemon Squeezy webhook request: HMAC-SHA256 lowercase-hex of
 * the RAW body in `X-Signature` — no message id, no signed timestamp
 * (see src/lib/lemonsqueezy.ts for why the replay stance differs from
 * the Polar-era Standard Webhooks scheme).
 */
export async function buildSignedLemonSqueezyWebhook(
  secret: string,
  event: {
    meta: { event_name: string; custom_data?: Record<string, unknown> };
    data: unknown;
  },
  options: { signatureOverride?: string } = {}
): Promise<{ headers: Headers; body: string }> {
  const body = JSON.stringify(event);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(body) as BufferSource
  );
  const bytes = new Uint8Array(sigBuf);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');

  const headers = new Headers({
    'content-type': 'application/json',
    'x-signature': options.signatureOverride ?? hex,
    'x-event-name': event.meta.event_name,
  });
  return { headers, body };
}
