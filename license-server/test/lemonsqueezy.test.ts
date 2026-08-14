import { describe, expect, it } from 'vitest';
import {
  deviceLimitForProduct,
  resolveVariantSku,
  storeMatches,
  verifyLemonSqueezyWebhook,
} from '../src/lib/lemonsqueezy';
import { buildSignedLemonSqueezyWebhook } from './helpers';

const SECRET = 'test-signing-secret';

const ORDER_EVENT = {
  meta: { event_name: 'order_created' },
  data: { type: 'orders', id: '1001', attributes: { store_id: 7, user_email: 'a@b.c' } },
};

describe('verifyLemonSqueezyWebhook', () => {
  it('accepts a body signed with the same secret', async () => {
    const { headers, body } = await buildSignedLemonSqueezyWebhook(SECRET, ORDER_EVENT);
    const result = await verifyLemonSqueezyWebhook(headers, body, SECRET);
    expect(result.ok).toBe(true);
  });

  it('rejects when the signature was made with a different secret', async () => {
    const { headers, body } = await buildSignedLemonSqueezyWebhook('wrong-secret', ORDER_EVENT);
    const result = await verifyLemonSqueezyWebhook(headers, body, SECRET);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('invalid-signature');
  });

  it('rejects when the body has been tampered with after signing', async () => {
    const { headers, body } = await buildSignedLemonSqueezyWebhook(SECRET, ORDER_EVENT);
    const tampered = body.replace('a@b.c', 'evil@b.c');
    const result = await verifyLemonSqueezyWebhook(headers, tampered, SECRET);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('invalid-signature');
  });

  it('rejects when the X-Signature header is absent', async () => {
    const { headers, body } = await buildSignedLemonSqueezyWebhook(SECRET, ORDER_EVENT);
    headers.delete('x-signature');
    const result = await verifyLemonSqueezyWebhook(headers, body, SECRET);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('missing-headers');
  });

  it('rejects when no secret is configured, surfacing invalid-secret so a misconfigured deploy is loud', async () => {
    const { headers, body } = await buildSignedLemonSqueezyWebhook(SECRET, ORDER_EVENT);
    const result = await verifyLemonSqueezyWebhook(headers, body, '');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('invalid-secret');
  });

  it('accepts an uppercase hex signature (header casing is not part of the LS contract)', async () => {
    const { headers, body } = await buildSignedLemonSqueezyWebhook(SECRET, ORDER_EVENT);
    const upper = headers.get('x-signature')!.toUpperCase();
    headers.set('x-signature', upper);
    const result = await verifyLemonSqueezyWebhook(headers, body, SECRET);
    expect(result.ok).toBe(true);
  });

  it('rejects a same-length garbage signature without timing shortcuts leaking a verdict path', async () => {
    const { headers, body } = await buildSignedLemonSqueezyWebhook(SECRET, ORDER_EVENT);
    headers.set('x-signature', 'f'.repeat(headers.get('x-signature')!.length));
    const result = await verifyLemonSqueezyWebhook(headers, body, SECRET);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('invalid-signature');
  });
});

describe('resolveVariantSku', () => {
  // Lemon Squeezy variant ids are numeric and configured through env
  // because they differ between test mode and live. These tests pin the
  // contract: NO fallback matching — an unmapped variant must resolve
  // null so the handler acks `unknown-product`, because the LS store is
  // shared with the maintainer's other products.
  const CONFIG = {
    LS_VARIANT_MONTHLY: '111',
    LS_VARIANT_LIFETIME: '222',
    LS_VARIANT_TEAM: '333',
  };

  it('maps each configured variant id to its canonical Lingua SKU', () => {
    expect(resolveVariantSku(111, CONFIG)).toBe('lingua_monthly');
    expect(resolveVariantSku(222, CONFIG)).toBe('lingua_lifetime');
    expect(resolveVariantSku(333, CONFIG)).toBe('lingua_team');
  });

  it('returns null for a sibling product variant (vitrine/gancho live in the same store)', () => {
    expect(resolveVariantSku(999, CONFIG)).toBeNull();
  });

  it('returns null when the variant id is missing or non-finite', () => {
    expect(resolveVariantSku(undefined, CONFIG)).toBeNull();
    expect(resolveVariantSku(Number.NaN, CONFIG)).toBeNull();
  });

  it('returns null for EVERY variant while the env vars are unset — the safe half-configured state', () => {
    expect(resolveVariantSku(111, {})).toBeNull();
    expect(resolveVariantSku(111, { LS_VARIANT_MONTHLY: '' })).toBeNull();
    expect(resolveVariantSku(111, { LS_VARIANT_MONTHLY: '   ' })).toBeNull();
  });

  it('never cross-matches: a lifetime variant id does not resolve through the monthly slot', () => {
    expect(resolveVariantSku(222, { LS_VARIANT_MONTHLY: '222' })).toBe('lingua_monthly');
    expect(resolveVariantSku(222, CONFIG)).toBe('lingua_lifetime');
  });
});

describe('storeMatches', () => {
  it('accepts any store while LS_STORE_ID is unset (variant resolution alone gates)', () => {
    expect(storeMatches(7, {})).toBe(true);
    expect(storeMatches(undefined, {})).toBe(true);
  });

  it('enforces the configured store id, rejecting foreign stores and missing ids', () => {
    const config = { LS_STORE_ID: '7' };
    expect(storeMatches(7, config)).toBe(true);
    expect(storeMatches(8, config)).toBe(false);
    expect(storeMatches(undefined, config)).toBe(false);
  });
});

describe('deviceLimitForProduct', () => {
  it('hard-codes 3 for monthly / lifetime regardless of custom data', () => {
    expect(deviceLimitForProduct('lingua_monthly', { device_limit: 50 })).toBe(3);
    expect(deviceLimitForProduct('lingua_lifetime', { device_limit: 50 })).toBe(3);
  });

  it('reads custom_data.device_limit only for the team SKU', () => {
    expect(deviceLimitForProduct('lingua_team', { device_limit: 25 })).toBe(25);
    expect(deviceLimitForProduct('lingua_team', undefined)).toBe(3);
  });

  it('parses string-typed values defensively (checkout custom data serializes as strings)', () => {
    expect(deviceLimitForProduct('lingua_team', { device_limit: '10' })).toBe(10);
  });

  it('clamps absurd values (negative / NaN / huge) to the default 3 to keep the schema CHECK happy', () => {
    expect(deviceLimitForProduct('lingua_team', { device_limit: -5 })).toBe(3);
    expect(deviceLimitForProduct('lingua_team', { device_limit: 'not-a-number' })).toBe(3);
    expect(deviceLimitForProduct('lingua_team', { device_limit: 99999 })).toBe(3);
  });
});
