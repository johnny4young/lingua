/**
 * Lemon Squeezy webhook signature verification + event types.
 *
 * Lemon Squeezy signs the RAW request body with HMAC-SHA256 using the
 * signing secret configured on the webhook, and transmits the lowercase
 * hex digest in the `X-Signature` header. Unlike Polar's Standard
 * Webhooks scheme there is NO signed timestamp and NO message id in the
 * canonical string — the replay defense therefore rests entirely on
 * application-layer idempotency: the `merchant_order_id` /
 * `merchant_subscription_id` UNIQUE lookups make a replayed event a
 * `duplicate` ack instead of a second mint. This trade-off is
 * deliberate and documented in the payments ADR; do not "harden" it by
 * parsing timestamps out of the payload, because the payload is
 * attacker-controlled once the secret leaks and worthless before that.
 *
 * The worker handles the event names the migration committed to:
 *   - `order_created`          → mint (lifetime) / ack (subscription variants)
 *   - `order_refunded`         → revoke license
 *   - `subscription_created`   → mint license (monthly / team)
 *   - `subscription_updated`   → renewal refresh + cancel_at_period_end
 *   - `subscription_cancelled` → flip status to cancel_at_period_end
 *
 * Unknown event names ack 200 (Lemon Squeezy retries non-2xx for three
 * days) with `{ ok: true, ignored: 'unknown-event' }` so a
 * misconfigured webhook surface is loud in the audit log without
 * triggering the retry storm.
 *
 * Product identity: Lemon Squeezy's numeric product/variant ids are
 * stable public identifiers (the vitrine pattern pins them in source).
 * The store is SHARED with the maintainer's other products, so every
 * event must resolve its variant id against the configured map before
 * anything mints — a valid purchase of a sibling product must ack
 * `unknown-product`, never issue a Lingua license. Variant ids arrive
 * through env (`LS_VARIANT_MONTHLY` / `LS_VARIANT_LIFETIME` /
 * `LS_VARIANT_TEAM`) because they differ between test and live modes.
 */

const ENCODER = new TextEncoder();

export type LemonSqueezyVerifyFailure =
  | { ok: false; reason: 'missing-headers'; message: string }
  | { ok: false; reason: 'invalid-signature'; message: string }
  | { ok: false; reason: 'invalid-secret'; message: string };

export type LemonSqueezyVerifyResult = { ok: true } | LemonSqueezyVerifyFailure;

/** Lowercase hex SHA-256 HMAC over the raw body. */
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, ENCODER.encode(message) as BufferSource);
  const bytes = new Uint8Array(signature);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
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

export async function verifyLemonSqueezyWebhook(
  headers: Headers,
  rawBody: string,
  secret: string
): Promise<LemonSqueezyVerifyResult> {
  if (!secret || secret.length === 0) {
    return { ok: false, reason: 'invalid-secret', message: 'LS_WEBHOOK_SECRET is not set.' };
  }

  const signatureHeader = headers.get('x-signature');
  if (!signatureHeader) {
    return {
      ok: false,
      reason: 'missing-headers',
      message: 'X-Signature is required.',
    };
  }

  let expected: string;
  try {
    expected = await hmacSha256Hex(secret, rawBody);
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid-secret',
      message: error instanceof Error ? error.message : 'LS_WEBHOOK_SECRET is invalid.',
    };
  }

  if (constantTimeEquals(signatureHeader.trim().toLowerCase(), expected)) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: 'invalid-signature',
    message: 'X-Signature did not match the expected HMAC of the body.',
  };
}

// ---------------------------------------------------------- Event types

/** Canonical Lingua SKUs — unchanged from the Polar era so `licenses.product_id` stays stable. */
export type LinguaProductId = 'lingua_monthly' | 'lingua_lifetime' | 'lingua_team';

/** The subset of env the resolver needs; `Env` satisfies it structurally. */
export interface VariantConfig {
  LS_STORE_ID?: string;
  LS_VARIANT_MONTHLY?: string;
  LS_VARIANT_LIFETIME?: string;
  LS_VARIANT_TEAM?: string;
}

export interface LemonSqueezyOrderAttributes {
  store_id?: number;
  user_email?: string;
  status?: string;
  refunded?: boolean;
  first_order_item?: {
    product_id?: number;
    variant_id?: number;
  };
}

export interface LemonSqueezySubscriptionAttributes {
  store_id?: number;
  order_id?: number;
  product_id?: number;
  variant_id?: number;
  user_email?: string;
  status?: string;
  cancelled?: boolean;
  renews_at?: string | null;
  ends_at?: string | null;
}

export interface LemonSqueezyEvent {
  meta?: {
    event_name?: string;
    custom_data?: Record<string, unknown>;
  };
  data?: {
    type?: string;
    id?: string;
    attributes?: Record<string, unknown>;
  };
}

/** Narrowed accessors — LS attributes arrive as a loose JSON:API bag. */
export function orderAttributes(event: LemonSqueezyEvent): LemonSqueezyOrderAttributes {
  return (event.data?.attributes ?? {}) as LemonSqueezyOrderAttributes;
}

export function subscriptionAttributes(
  event: LemonSqueezyEvent
): LemonSqueezySubscriptionAttributes {
  return (event.data?.attributes ?? {}) as LemonSqueezySubscriptionAttributes;
}

/**
 * Resolve the canonical Lingua SKU from a Lemon Squeezy variant id.
 *
 * The maintainer configures the numeric variant ids through env
 * (`wrangler.toml` [vars] — they are public identifiers, not secrets).
 * Until the vars are set every event acks `unknown-product`, which is
 * the safe failure mode for a half-configured deploy. The store is
 * shared with sibling products, so a missing mapping must NEVER fall
 * back to "any paid order mints".
 */
export function resolveVariantSku(
  variantId: number | undefined,
  config: VariantConfig
): LinguaProductId | null {
  if (variantId === undefined || !Number.isFinite(variantId)) return null;
  const candidate = String(variantId);
  if (candidate === trimmedOrNull(config.LS_VARIANT_MONTHLY)) return 'lingua_monthly';
  if (candidate === trimmedOrNull(config.LS_VARIANT_LIFETIME)) return 'lingua_lifetime';
  if (candidate === trimmedOrNull(config.LS_VARIANT_TEAM)) return 'lingua_team';
  return null;
}

/**
 * When `LS_STORE_ID` is configured, an event from any other store is
 * rejected before variant resolution. Defense-in-depth for the shared
 * signing secret scenario; when unset, variant resolution alone gates.
 */
export function storeMatches(storeId: number | undefined, config: VariantConfig): boolean {
  const expected = trimmedOrNull(config.LS_STORE_ID);
  if (expected === null) return true;
  if (storeId === undefined || !Number.isFinite(storeId)) return false;
  return String(storeId) === expected;
}

function trimmedOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Read `device_limit` from the checkout's custom data, with the same
 * clamping the Polar path used. Only `lingua_team` honours the
 * override; monthly + lifetime are hard-3. Lemon Squeezy carries
 * checkout custom data in `meta.custom_data` on every webhook for the
 * resulting order/subscription.
 */
export function deviceLimitForProduct(
  productId: string,
  customData: Record<string, unknown> | undefined
): number {
  if (productId !== 'lingua_team') return 3;
  const raw = customData?.device_limit;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 && raw <= 1000) {
    return Math.floor(raw);
  }
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 1000) return parsed;
  }
  return 3;
}
