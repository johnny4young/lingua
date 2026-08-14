#!/usr/bin/env node
/**
 * Local smoke test — sign a fake Lemon Squeezy webhook with the same
 * HMAC-SHA256-hex `X-Signature` scheme the worker expects, POST it to
 * the deployed `/webhooks/lemonsqueezy` endpoint, and print the
 * response.
 *
 * Skips Lemon Squeezy entirely. Lets a maintainer verify the worker
 * stack (signature verification + JSON parsing + DB write + Resend
 * email) before exposing the deploy to real webhook traffic.
 *
 * Usage:
 *   LS_WEBHOOK_SECRET=xxx \
 *     node scripts/smoke-webhook.mjs --url https://licenses.linguacode.dev \
 *     --event order_created --variant 222 --email you@example.com
 *
 * Defaults to an `order_created` for the lifetime variant because it
 * exercises the full mint + email + DB-write happy path. The variant
 * ids MUST match the worker's LS_VARIANT_* vars or the worker will
 * (correctly) ack `unknown-product` — that ack is itself a useful
 * smoke: it proves the shared-store rejection works.
 */

import { webcrypto as crypto } from 'node:crypto';
import { argv, env } from 'node:process';

function parseArgs(args) {
  const out = {};
  for (let i = 2; i < args.length; i += 1) {
    const flag = args[i];
    const next = args[i + 1];
    if (flag === '--url') {
      out.url = next;
      i += 1;
    } else if (flag === '--event') {
      out.event = next;
      i += 1;
    } else if (flag === '--variant') {
      out.variant = next;
      i += 1;
    } else if (flag === '--store') {
      out.store = next;
      i += 1;
    } else if (flag === '--email') {
      out.email = next;
      i += 1;
    } else if (flag === '--help' || flag === '-h') {
      out.help = true;
    }
  }
  return out;
}

const args = parseArgs(argv);

if (args.help) {
  console.log(`Smoke test the deployed Lemon Squeezy webhook.

Required env:
  LS_WEBHOOK_SECRET      The same signing secret the worker has set.

Required flags:
  --url <base>           Worker base URL, e.g. https://licenses.linguacode.dev
                         The script appends /webhooks/lemonsqueezy.

Optional flags:
  --event <name>         Event name (default: order_created).
                         Supported: order_created, order_refunded,
                         subscription_created, subscription_updated,
                         subscription_cancelled.
  --variant <id>         Numeric variant id. Must match one of the
                         worker's LS_VARIANT_* values to mint; any other
                         value proves the unknown-product rejection.
  --store <id>           Numeric store id for the payload (default: 1).
  --email <addr>         Buyer email used in the synthetic payload
                         (default: smoke@linguacode.dev).
`);
  process.exit(0);
}

const secret = env.LS_WEBHOOK_SECRET;
if (!secret) {
  console.error('error: LS_WEBHOOK_SECRET env var is required.');
  console.error('  Get it from: wrangler secret list --name lingua-license-server');
  console.error('  (or copy from Lemon Squeezy → Settings → Webhooks → the endpoint).');
  process.exit(1);
}

const url = args.url;
if (!url) {
  console.error('error: --url is required, e.g. --url https://licenses.linguacode.dev');
  process.exit(1);
}

const eventName = args.event ?? 'order_created';
const variantId = Number.parseInt(args.variant ?? '222', 10);
const storeId = Number.parseInt(args.store ?? '1', 10);
const email = args.email ?? 'smoke@linguacode.dev';

// Synthetic ids are numeric-looking strings like Lemon Squeezy's own.
const orderId = String(Date.now());
const subId = `${Date.now() + 1}`;
const renewsAtIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

let body;
switch (eventName) {
  case 'order_created':
    body = {
      meta: { event_name: 'order_created' },
      data: {
        type: 'orders',
        id: orderId,
        attributes: {
          store_id: storeId,
          user_email: email,
          status: 'paid',
          refunded: false,
          first_order_item: { product_id: 0, variant_id: variantId },
        },
      },
    };
    break;
  case 'order_refunded':
    body = {
      meta: { event_name: 'order_refunded' },
      data: {
        type: 'orders',
        id: orderId,
        attributes: { store_id: storeId, refunded: true },
      },
    };
    break;
  case 'subscription_created':
    body = {
      meta: { event_name: 'subscription_created' },
      data: {
        type: 'subscriptions',
        id: subId,
        attributes: {
          store_id: storeId,
          order_id: Number(orderId),
          variant_id: variantId,
          user_email: email,
          status: 'active',
          cancelled: false,
          renews_at: renewsAtIso,
        },
      },
    };
    break;
  case 'subscription_updated':
    body = {
      meta: { event_name: 'subscription_updated' },
      data: {
        type: 'subscriptions',
        id: subId,
        attributes: {
          store_id: storeId,
          variant_id: variantId,
          user_email: email,
          status: 'active',
          cancelled: false,
          renews_at: renewsAtIso,
        },
      },
    };
    break;
  case 'subscription_cancelled':
    body = {
      meta: { event_name: 'subscription_cancelled' },
      data: {
        type: 'subscriptions',
        id: subId,
        attributes: { store_id: storeId, cancelled: true },
      },
    };
    break;
  default:
    console.error(`error: unsupported --event ${eventName}`);
    process.exit(1);
}

const rawBody = JSON.stringify(body);

// HMAC-SHA256 lowercase hex over the RAW body — the exact scheme
// src/lib/lemonsqueezy.ts verifies. No message id, no timestamp.
const key = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(secret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign']
);
const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
const signature = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, '0')).join('');

const target = `${url.replace(/\/$/, '')}/webhooks/lemonsqueezy`;
console.log(`POST ${target}`);
console.log(`  event=${eventName} variant=${variantId} store=${storeId}`);

const response = await fetch(target, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-signature': signature,
    'x-event-name': eventName,
  },
  body: rawBody,
});

const text = await response.text();
console.log(`HTTP ${response.status}`);
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}
process.exit(response.ok ? 0 : 1);
