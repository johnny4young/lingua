import { describe, expect, it } from 'vitest';
import {
  deviceLimitForProduct,
  resolveProductSku,
  verifyPolarWebhook,
} from '../src/lib/polar';
import { buildSignedPolarWebhook } from './helpers';

const WHSEC = 'whsec_dGVzdC1zZWNyZXQ='; // "test-secret" base64'd

describe('verifyPolarWebhook', () => {
  it('accepts a freshly signed webhook from the same secret as the v1 spec line', async () => {
    const { headers, body } = await buildSignedPolarWebhook(WHSEC, {
      type: 'order.paid',
      data: { id: 'order_abc' },
    });
    const result = await verifyPolarWebhook(headers, body, WHSEC);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.webhookId).toMatch(/^msg_/);
  });

  it('rejects when the signature was made with a different secret', async () => {
    const { headers, body } = await buildSignedPolarWebhook('whsec_d3Jvbmctc2VjcmV0', {
      type: 'order.paid',
      data: { id: 'order_abc' },
    });
    const result = await verifyPolarWebhook(headers, body, WHSEC);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('invalid-signature');
  });

  it('rejects when the body has been tampered with after signing — defends against replay-with-modification attacks', async () => {
    const { headers, body } = await buildSignedPolarWebhook(WHSEC, {
      type: 'order.paid',
      data: { id: 'order_abc' },
    });
    const tampered = body.replace('order_abc', 'order_xyz');
    const result = await verifyPolarWebhook(headers, tampered, WHSEC);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('invalid-signature');
  });

  it('rejects an outdated timestamp as replay-window so a captured webhook cannot be replayed days later', async () => {
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
    const { headers, body } = await buildSignedPolarWebhook(
      WHSEC,
      { type: 'order.paid', data: { id: 'order_abc' } },
      { timestamp: tenMinutesAgo }
    );
    const result = await verifyPolarWebhook(headers, body, WHSEC);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('replay-window');
  });

  it('rejects when the webhook-id, webhook-timestamp, or webhook-signature header is absent', async () => {
    for (const drop of ['webhook-id', 'webhook-timestamp', 'webhook-signature']) {
      const { headers, body } = await buildSignedPolarWebhook(WHSEC, {
        type: 'order.paid',
        data: { id: 'order_abc' },
      });
      headers.delete(drop);
      const result = await verifyPolarWebhook(headers, body, WHSEC);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.reason).toBe('missing-headers');
    }
  });

  it('rejects when no secret is configured, surfacing invalid-secret so a misconfigured deploy is loud', async () => {
    const { headers, body } = await buildSignedPolarWebhook(WHSEC, {
      type: 'order.paid',
      data: { id: 'order_abc' },
    });
    const result = await verifyPolarWebhook(headers, body, '');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('invalid-secret');
  });

  it('rejects a malformed whsec secret as invalid-secret instead of throwing into a 500', async () => {
    const { headers, body } = await buildSignedPolarWebhook(WHSEC, {
      type: 'order.paid',
      data: { id: 'order_abc' },
    });
    const result = await verifyPolarWebhook(headers, body, 'whsec_!!!!');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('invalid-secret');
  });

  it('accepts a non-prefixed plain string secret (used in local dev / tests without Polar provisioning)', async () => {
    const { headers, body } = await buildSignedPolarWebhook('plain-string-secret', {
      type: 'order.paid',
      data: { id: 'order_abc' },
    });
    const result = await verifyPolarWebhook(headers, body, 'plain-string-secret');
    expect(result.ok).toBe(true);
  });
});

describe('deviceLimitForProduct', () => {
  it('hard-codes 3 for monthly / lifetime regardless of metadata', () => {
    expect(deviceLimitForProduct('lingua_monthly', { device_limit: 50 })).toBe(3);
    expect(deviceLimitForProduct('lingua_lifetime', { device_limit: 50 })).toBe(3);
  });

  it('reads metadata.device_limit only for the team SKU', () => {
    expect(deviceLimitForProduct('lingua_team', { device_limit: 25 })).toBe(25);
    expect(deviceLimitForProduct('lingua_team', undefined)).toBe(3);
  });

  it('parses string-typed metadata values defensively (Polar sometimes serializes numbers as strings)', () => {
    expect(deviceLimitForProduct('lingua_team', { device_limit: '10' })).toBe(10);
  });

  it('clamps absurd values (negative / NaN / huge) to the default 3 to keep the schema CHECK happy', () => {
    expect(deviceLimitForProduct('lingua_team', { device_limit: -5 })).toBe(3);
    expect(deviceLimitForProduct('lingua_team', { device_limit: 'not-a-number' })).toBe(3);
    expect(deviceLimitForProduct('lingua_team', { device_limit: 99999 })).toBe(3);
  });
});

describe('resolveProductSku', () => {
  // Polar's `product.id` is an autogenerated UUID — see the helper
  // doc-comment for why metadata.product_id is the canonical source.
  // These tests pin the contract so a future refactor can't silently
  // start matching on the UUID and break every webhook in production.
  const POLAR_UUID = '01234567-89ab-cdef-0123-456789abcdef';

  it('returns the canonical slug from metadata.product_id when it is one of the known SKUs', () => {
    expect(resolveProductSku({ id: POLAR_UUID, metadata: { product_id: 'lingua_monthly' } })).toBe(
      'lingua_monthly'
    );
    expect(resolveProductSku({ id: POLAR_UUID, metadata: { product_id: 'lingua_lifetime' } })).toBe(
      'lingua_lifetime'
    );
    expect(resolveProductSku({ id: POLAR_UUID, metadata: { product_id: 'lingua_team' } })).toBe(
      'lingua_team'
    );
  });

  it('returns null when product or metadata is absent (forces handler to ack `unknown-product` instead of a wrongly-cast PolarProductId)', () => {
    expect(resolveProductSku(undefined)).toBeNull();
    expect(resolveProductSku({ id: POLAR_UUID })).toBeNull();
    expect(resolveProductSku({ id: POLAR_UUID, metadata: {} })).toBeNull();
  });

  it('returns null when metadata.product_id is set but not a known Lingua SKU', () => {
    // Typo — the maintainer mistyped the SKU in Polar's metadata UI.
    expect(
      resolveProductSku({ id: POLAR_UUID, metadata: { product_id: 'lingua_montly' } })
    ).toBeNull();
    // A slug we may add later but that the deployed worker doesn't know yet.
    expect(
      resolveProductSku({ id: POLAR_UUID, metadata: { product_id: 'lingua_education' } })
    ).toBeNull();
  });

  it('returns null when metadata.product_id is the wrong type (number, object, etc.) — defends against API drift', () => {
    expect(
      resolveProductSku({ id: POLAR_UUID, metadata: { product_id: 42 as unknown as string } })
    ).toBeNull();
    expect(
      resolveProductSku({
        id: POLAR_UUID,
        metadata: { product_id: { value: 'lingua_monthly' } as unknown as string },
      })
    ).toBeNull();
  });

  it('does NOT fall back to product.id even if it happens to look like a Lingua slug (UUID is never a slug)', () => {
    // A maintainer accidentally putting `lingua_monthly` into the Name
    // field instead of the Metadata field would still surface as
    // unknown-product, forcing them to fix the metadata properly.
    expect(resolveProductSku({ id: 'lingua_monthly' })).toBeNull();
  });
});
