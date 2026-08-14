# Runbook — Lemon Squeezy webhook replay

**Severity:** S1 (degraded). Customer paid but did not receive a license.
**Owner:** maintainer (single-operator rotation, see `docs/SERVER_OBSERVABILITY.md` § Rotation).
**Related:** the internal licensing ADR (webhook contract), `license-server/src/handlers/webhooks.ts`.

## Detection

The operator notices any of:

- The Lemon Squeezy dashboard reports a delivery failure (Settings → Webhooks → the endpoint → recent deliveries; failed sends retry automatically for three days before giving up).
- Customer support email: "I paid but never got a license token".
- Log alert fires on `request.completed { route: 'webhooks.lemonsqueezy', errorClass: 'client' }` rate spike.
- Synthetic monitor fires on `request.completed { route: 'webhooks.lemonsqueezy', status: 5xx }` for >0% over 1h.

## Mitigation

Webhook processing is **idempotent** — replaying a successful delivery is safe; the handler dedupes by `merchant_order_id` / `merchant_subscription_id` in D1. With no signed timestamp in Lemon Squeezy's scheme, that dedupe IS the replay defense, so exercising it is routine.

Preferred: resend from the dashboard.

1. Lemon Squeezy → Settings → Webhooks → the Lingua endpoint → open the failed delivery → **Resend**. The dashboard re-signs and re-delivers the original payload; no manual signature handling.

Manual replay (only if the dashboard resend is unavailable):

1. Copy the delivery's payload JSON from the dashboard.
2. Sanity-check the payload's `user_email` matches the customer ticket.
3. Replay against the production worker — the `X-Signature` must be the HMAC-SHA256 hex of the EXACT body bytes, so keep the payload byte-identical:
   ```bash
   curl -X POST https://licenses.linguacode.dev/webhooks/lemonsqueezy \
     -H "X-Signature: <signature from the delivery details>" \
     -H "Content-Type: application/json" \
     --data-binary @payload.json
   ```
4. Tail logs in a second terminal to confirm:
   ```bash
   wrangler tail --format=pretty | grep -E '"route":"webhooks.lemonsqueezy"'
   ```
   - Success: `"event":"request.completed"` with `"route":"webhooks.lemonsqueezy"` and `"status":200`.
   - Idempotent retry: same request envelope with `"status":200`; D1 remains single-row because the handler dedupes by merchant id.
   - Failed: `"errorClass":"client"` with `"status":400` or `"status":401` → the signature or body bytes drifted; use the dashboard Resend instead.

## Rollback

Webhook replays are idempotent. If the replay landed but the customer still reports a missing license, the failure is downstream (Resend email delivery) — see `license-recovery.md` for the manual reissue path.

To revoke a license that was minted in error:

```sql
-- D1 console (wrangler d1 execute lingua-licenses --command)
UPDATE licenses
   SET status = 'refunded', updated_at = strftime('%s', 'now') * 1000
 WHERE merchant_order_id = '<order_id>';
```

The renderer will reflect the status change on the next `licenses/status` poll (within 24h on the desktop client; immediately on web).

## Customer-support note

Template reply (English; mirror in Spanish for ES customers):

```
Hi <name>,

We've replayed your purchase webhook and your license <last 4 of token> is
now active. The activation email is on its way to <email>; please check
spam if it doesn't land within 5 minutes.

If the activation still fails, reply with the email subject "License
recovery" and we'll resend the token directly.

— Lingua support
```

## Validation

Confirm the replay landed:

1. D1 row exists: `SELECT id, status, issued_to FROM licenses WHERE merchant_order_id = '<order_id>';` should return one row with `status = 'active'`.
2. Email delivery: check the Resend dashboard for the outbound message to `<customer_email>`.
3. Customer confirms receipt + activation in the desktop app.
