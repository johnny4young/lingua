/**
 * Polar webhook signature verification + event types.
 *
 * Polar follows the Standard Webhooks spec
 * (https://www.standardwebhooks.com/). The signature is HMAC-SHA256
 * over `${webhook-id}.${webhook-timestamp}.${body}` with the secret
 * `whsec_<base64>` Polar provisions, transmitted in the
 * `webhook-signature` header as `v1,<base64>` (multiple comma-separated
 * versions allowed; we accept any `v1`-prefixed entry that matches).
 *
 * We verify three pieces:
 *
 *   1. The signature matches our shared secret over the canonical
 *      `id.timestamp.body` string.
 *   2. The timestamp is within ±5min of `Date.now()` to defend against
 *      replay attacks (Polar's window matches the spec).
 *   3. We have not seen this `webhook-id` before — handler-side
 *      idempotency via the `polar_order_id` / `polar_subscription_id`
 *      UNIQUE indexes; Slice 2 chooses the simpler "don't dedupe at
 *      the signature layer, dedupe at the application layer" approach
 *      because Polar already retries with the same id and we want
 *      the application to be idempotent regardless.
 *
 * Slice 2 only handles the event types the LICENSING_ADR Decision 2
 * Slice sequencing committed to:
 *   - `order.paid`           → mint license (lifetime / team)
 *   - `order.refunded`       → revoke license
 *   - `subscription.created` → mint license (monthly initial)
 *   - `subscription.updated` → refresh token + expires_at
 *   - `subscription.canceled`→ flip status to cancel_at_period_end
 *
 * Unknown event types ack 200 (idempotent — Polar does not retry on
 * 200 even for unhandled events) and the handler returns a structured
 * `{ ok: true, ignored: true, reason: 'unknown-event' }` so a
 * misconfigured webhook surface is loud in the audit log without
 * triggering Polar's retry storm.
 */

const ENCODER = new TextEncoder();

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export type PolarVerifyFailure =
  | { ok: false; reason: 'missing-headers'; message: string }
  | { ok: false; reason: 'bad-timestamp'; message: string }
  | { ok: false; reason: 'replay-window'; message: string }
  | { ok: false; reason: 'invalid-signature'; message: string }
  | { ok: false; reason: 'invalid-secret'; message: string };

export type PolarVerifyResult = { ok: true; webhookId: string } | PolarVerifyFailure;

/** Base64 SHA-256 HMAC over the canonical signing string. */
async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  // The Polar secret is a `whsec_<base64>` string. Standard Webhooks
  // documents that the implementation should base64-decode after the
  // `whsec_` prefix; if the prefix is absent we use the raw string
  // bytes (lets local tests use a plain key without the prefix).
  let keyBytes: Uint8Array;
  if (secret.startsWith('whsec_')) {
    const base64 = secret.slice('whsec_'.length);
    const padLength = (4 - (base64.length % 4)) % 4;
    const normalized = base64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLength);
    const binary = atob(normalized);
    keyBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) keyBytes[i] = binary.charCodeAt(i);
  } else {
    keyBytes = ENCODER.encode(secret);
  }

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    ENCODER.encode(message) as BufferSource
  );
  // Base64 (NOT base64url) per Standard Webhooks spec.
  let binary = '';
  const bytes = new Uint8Array(signature);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Constant-time string compare so a timing oracle can't leak the
 * expected signature one byte at a time.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function verifyPolarWebhook(
  headers: Headers,
  rawBody: string,
  secret: string,
  now: number = Date.now()
): Promise<PolarVerifyResult> {
  if (!secret || secret.length === 0) {
    return { ok: false, reason: 'invalid-secret', message: 'POLAR_WEBHOOK_SECRET is not set.' };
  }

  const webhookId = headers.get('webhook-id');
  const webhookTimestamp = headers.get('webhook-timestamp');
  const webhookSignature = headers.get('webhook-signature');

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return {
      ok: false,
      reason: 'missing-headers',
      message: 'webhook-id, webhook-timestamp, webhook-signature are all required.',
    };
  }

  const ts = Number.parseInt(webhookTimestamp, 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'bad-timestamp', message: 'webhook-timestamp is not numeric.' };
  }
  // Standard Webhooks timestamp is in seconds.
  const tsMs = ts * 1000;
  if (Math.abs(now - tsMs) > FIVE_MINUTES_MS) {
    return {
      ok: false,
      reason: 'replay-window',
      message: 'webhook-timestamp is outside the ±5min window.',
    };
  }

  const signingString = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  let expected: string;
  try {
    expected = await hmacSha256Base64(secret, signingString);
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid-secret',
      message: error instanceof Error ? error.message : 'POLAR_WEBHOOK_SECRET is invalid.',
    };
  }

  // Header may carry multiple signatures separated by spaces:
  //   `v1,<sig1> v1,<sig2>`
  // We accept if any v1-prefixed entry matches the expected digest.
  for (const piece of webhookSignature.split(' ')) {
    const [version, sig] = piece.split(',');
    if (version === 'v1' && sig && constantTimeEquals(sig, expected)) {
      return { ok: true, webhookId };
    }
  }

  return {
    ok: false,
    reason: 'invalid-signature',
    message: 'No v1 signature in the header matched the expected HMAC.',
  };
}

// ---------------------------------------------------------- Event types

export type PolarProductId = 'lingua_monthly' | 'lingua_lifetime' | 'lingua_team';

export interface PolarOrderPaidEvent {
  type: 'order.paid';
  data: {
    id: string;
    billing_reason?: string;
    subscription_id?: string | null;
    customer: { email: string };
    product: { id: string; name?: string; metadata?: Record<string, unknown> };
    subscription?: { id: string; current_period_end?: string | null };
    amount?: number;
  };
}

export interface PolarOrderRefundedEvent {
  type: 'order.refunded';
  data: {
    id: string;
    order: { id: string };
  };
}

export interface PolarSubscriptionCreatedEvent {
  type: 'subscription.created';
  data: {
    id: string;
    customer: { email: string };
    product: { id: string; metadata?: Record<string, unknown> };
    current_period_end: string; // ISO timestamp
  };
}

export interface PolarSubscriptionUpdatedEvent {
  type: 'subscription.updated';
  data: {
    id: string;
    customer: { email: string };
    current_period_end: string; // ISO timestamp
    cancel_at_period_end?: boolean;
  };
}

export interface PolarSubscriptionCanceledEvent {
  type: 'subscription.canceled';
  data: { id: string };
}

export type PolarKnownEvent =
  | PolarOrderPaidEvent
  | PolarOrderRefundedEvent
  | PolarSubscriptionCreatedEvent
  | PolarSubscriptionUpdatedEvent
  | PolarSubscriptionCanceledEvent;

export type PolarEvent = PolarKnownEvent | { type: string; data?: unknown };

export const KNOWN_PRODUCT_IDS: ReadonlySet<string> = new Set<PolarProductId>([
  'lingua_monthly',
  'lingua_lifetime',
  'lingua_team',
]);

/**
 * Resolve the canonical Lingua SKU from a Polar product object.
 *
 * Polar's `product.id` is an autogenerated UUID — it differs between
 * sandbox and production and is opaque to humans, so the worker can't
 * match against it directly. The maintainer is responsible for setting
 * `metadata.product_id` to one of the values in `KNOWN_PRODUCT_IDS`
 * when creating the product in the Polar dashboard. This helper reads
 * that metadata and validates it against the known set; the caller
 * receives `null` for any product that doesn't carry a recognised
 * slug, which the webhook handlers translate to
 * `{ ok: true, ignored: 'unknown-product' }`.
 *
 * Documented in the internal licensing ADR Decision 2 and
 * `license-server/README.md` "Maintainer-side prerequisites".
 */
export function resolveProductSku(
  product: { id?: string; metadata?: Record<string, unknown> } | undefined
): PolarProductId | null {
  if (!product) return null;
  const raw = product.metadata?.product_id;
  if (typeof raw !== 'string') return null;
  if (!KNOWN_PRODUCT_IDS.has(raw)) return null;
  return raw as PolarProductId;
}

/**
 * Read `metadata.device_limit` from a Polar product, with sensible
 * fallback. Per LICENSING_ADR Decision 3, only `lingua_team` honours
 * the override; monthly + lifetime are hard-3.
 */
export function deviceLimitForProduct(
  productId: string,
  metadata: Record<string, unknown> | undefined
): number {
  if (productId !== 'lingua_team') return 3;
  const raw = metadata?.device_limit;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 && raw <= 1000) {
    return Math.floor(raw);
  }
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 1000) return parsed;
  }
  return 3;
}
