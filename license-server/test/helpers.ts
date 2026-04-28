/**
 * Tiny in-memory D1 mock + env factory for license-server tests.
 *
 * Why hand-rolled (no better-sqlite3, no miniflare): vitest-pool-workers
 * requires vitest 4.x which the parent repo isn't on yet, and
 * better-sqlite3 needs native compilation. The tests we run here only
 * need three SQL shapes (INSERT, SELECT one, UPDATE) so a 100-line
 * Map-backed double covers everything Slice 2 exercises.
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
  polar_order_id: string | null;
  polar_subscription_id: string | null;
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

class MockD1Database {
  licenses = new Map<string, LicenseRow>();
  devices = new Map<string, DeviceRow>();

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
    if (q.startsWith('SELECT * FROM licenses WHERE polar_subscription_id =')) {
      const [subscriptionId] = this.boundParams as [string];
      const row = [...this.db.licenses.values()].find(
        (r) => r.polar_subscription_id === subscriptionId
      );
      return row ? [row] : [];
    }
    if (q.startsWith('SELECT * FROM licenses WHERE polar_order_id =')) {
      const [orderId] = this.boundParams as [string];
      const row = [...this.db.licenses.values()].find((r) => r.polar_order_id === orderId);
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
        polar_order_id,
        polar_subscription_id,
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
        polar_order_id,
        polar_subscription_id,
        created_at,
        updated_at,
      });
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
  polarWebhookSecret?: string;
  privateKeyJwk?: JsonWebKey;
  publicKeyJwk?: JsonWebKey;
  resendApiKey?: string;
  corsAllowedOrigins?: string;
  fetchImpl?: typeof fetch;
}

export function createMockEnv(options: MockEnvOptions = {}): Env & { __db: MockD1Database } {
  const db = createMockD1();
  return {
    DB: db as unknown as D1Database,
    RATE_LIMIT: createMockKV(),
    POLAR_WEBHOOK_SECRET: options.polarWebhookSecret ?? '',
    POLAR_API_KEY: 'pk_mock',
    LINGUA_LICENSE_PRIVATE_KEY_JWK: options.privateKeyJwk ? JSON.stringify(options.privateKeyJwk) : '',
    LINGUA_LICENSE_PUBLIC_KEY_JWK: options.publicKeyJwk ? JSON.stringify(options.publicKeyJwk) : '',
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
 * Build a Polar webhook signed with `secret`. Returns headers + body
 * pair ready to plug into `app.request(...)`.
 */
export async function buildSignedPolarWebhook(
  secret: string,
  event: { type: string; data: unknown },
  options: { id?: string; timestamp?: number } = {}
): Promise<{ headers: Headers; body: string }> {
  const body = JSON.stringify(event);
  const id = options.id ?? `msg_${crypto.randomUUID()}`;
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const signingString = `${id}.${timestamp}.${body}`;

  const keyBytes = secret.startsWith('whsec_')
    ? base64ToBytes(secret.slice('whsec_'.length))
    : new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingString) as BufferSource
  );
  const sigBytes = new Uint8Array(sigBuf);
  let binary = '';
  for (const byte of sigBytes) binary += String.fromCharCode(byte);
  const sigBase64 = btoa(binary);

  const headers = new Headers({
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': `v1,${sigBase64}`,
  });
  return { headers, body };
}

function base64ToBytes(base64: string): Uint8Array {
  const padLength = (4 - (base64.length % 4)) % 4;
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLength);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
