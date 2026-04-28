#!/usr/bin/env node
/**
 * Local smoke test — sign a fake Polar webhook with the same Standard
 * Webhooks v1 HMAC the worker expects, POST it to the deployed
 * `/webhooks/polar` endpoint, and print the response.
 *
 * Skips Polar entirely. Lets a maintainer verify the worker stack
 * (signature verification + JSON parsing + DB write + Resend email)
 * before exposing the deploy to real Polar traffic.
 *
 * Usage:
 *   POLAR_WEBHOOK_SECRET=whsec_xxx \
 *     node scripts/smoke-webhook.mjs --url https://licenses.linguacode.dev \
 *     --type order.paid --product lingua_lifetime --email you@example.com
 *
 * Defaults to a `lingua_lifetime` order.paid event because it
 * exercises the full mint + email + DB-write happy path.
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
    } else if (flag === '--type') {
      out.type = next;
      i += 1;
    } else if (flag === '--product') {
      out.product = next;
      i += 1;
    } else if (flag === '--email') {
      out.email = next;
      i += 1;
    } else if (flag === '--device-limit') {
      out.deviceLimit = next;
      i += 1;
    } else if (flag === '--help' || flag === '-h') {
      out.help = true;
    }
  }
  return out;
}

const args = parseArgs(argv);

if (args.help) {
  console.log(`Smoke test the deployed Polar webhook.

Required env:
  POLAR_WEBHOOK_SECRET   The same whsec_... value the worker has set.

Required flags:
  --url <base>           Worker base URL, e.g. https://licenses.linguacode.dev
                         The script appends /webhooks/polar.

Optional flags:
  --type <event>         Polar event type (default: order.paid).
                         Supported: order.paid, order.refunded,
                         subscription.created, subscription.updated,
                         subscription.canceled.
  --product <slug>       lingua_monthly | lingua_lifetime | lingua_team
                         (default: lingua_lifetime).
  --email <addr>         Buyer email used in the synthetic payload
                         (default: smoke@linguacode.dev).
  --device-limit <n>     Override device_limit metadata (lingua_team only).
`);
  process.exit(0);
}

const secret = env.POLAR_WEBHOOK_SECRET;
if (!secret) {
  console.error('error: POLAR_WEBHOOK_SECRET env var is required.');
  console.error('  Get it from: wrangler secret list --name lingua-license-server');
  console.error('  (or copy from your Polar dashboard → Settings → Webhooks).');
  process.exit(1);
}

const url = args.url;
if (!url) {
  console.error('error: --url is required, e.g. --url https://licenses.linguacode.dev');
  process.exit(1);
}

const eventType = args.type ?? 'order.paid';
const product = args.product ?? 'lingua_lifetime';
const email = args.email ?? 'smoke@linguacode.dev';
const deviceLimit = args.deviceLimit;

// Build a synthetic payload that mirrors the shape of real Polar
// events. Only the fields the worker actually reads need to be present.
const POLAR_FAKE_UUID = '01234567-89ab-cdef-0123-456789abcdef';
const orderId = `smoke_order_${Date.now()}`;
const subId = `smoke_sub_${Date.now()}`;
const periodEndIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const metadata = { product_id: product };
if (deviceLimit) metadata.device_limit = deviceLimit;

let body;
switch (eventType) {
  case 'order.paid':
    body = {
      type: 'order.paid',
      data: {
        id: orderId,
        billing_reason: product === 'lingua_lifetime' ? 'purchase' : 'subscription_create',
        subscription_id: product === 'lingua_lifetime' ? null : subId,
        customer: { email },
        product: { id: POLAR_FAKE_UUID, name: `Lingua — ${product}`, metadata },
        subscription:
          product === 'lingua_lifetime'
            ? undefined
            : { id: subId, current_period_end: periodEndIso },
      },
    };
    break;
  case 'order.refunded':
    body = { type: 'order.refunded', data: { id: orderId, order: { id: orderId } } };
    break;
  case 'subscription.created':
    body = {
      type: 'subscription.created',
      data: {
        id: subId,
        customer: { email },
        product: { id: POLAR_FAKE_UUID, metadata },
        current_period_end: periodEndIso,
      },
    };
    break;
  case 'subscription.updated':
    body = {
      type: 'subscription.updated',
      data: {
        id: subId,
        customer: { email },
        current_period_end: periodEndIso,
        cancel_at_period_end: false,
      },
    };
    break;
  case 'subscription.canceled':
    body = { type: 'subscription.canceled', data: { id: subId } };
    break;
  default:
    console.error(`error: unsupported --type ${eventType}`);
    process.exit(1);
}

const rawBody = JSON.stringify(body);
const webhookId = `msg_smoke_${Date.now()}`;
const webhookTimestamp = Math.floor(Date.now() / 1000).toString();
const signingString = `${webhookId}.${webhookTimestamp}.${rawBody}`;

// HMAC-SHA256 over the signing string with the whsec_ secret unwrapped.
let keyBytes;
if (secret.startsWith('whsec_')) {
  const base64 = secret.slice('whsec_'.length);
  const padLength = (4 - (base64.length % 4)) % 4;
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLength);
  keyBytes = Buffer.from(normalized, 'base64');
} else {
  keyBytes = Buffer.from(secret, 'utf-8');
}

const key = await crypto.subtle.importKey(
  'raw',
  keyBytes,
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign']
);
const signatureBuffer = await crypto.subtle.sign('HMAC', key, Buffer.from(signingString, 'utf-8'));
const signatureBase64 = Buffer.from(signatureBuffer).toString('base64');

const headers = {
  'content-type': 'application/json',
  'webhook-id': webhookId,
  'webhook-timestamp': webhookTimestamp,
  'webhook-signature': `v1,${signatureBase64}`,
};

const target = `${url.replace(/\/$/, '')}/webhooks/polar`;
console.log(`→ POST ${target}`);
console.log(`  type=${eventType} product=${product} email=${email}`);

const response = await fetch(target, {
  method: 'POST',
  headers,
  body: rawBody,
});

const text = await response.text();
let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  parsed = text;
}

console.log(`← ${response.status} ${response.statusText}`);
console.log(parsed);

if (response.status >= 400) {
  process.exit(1);
}
