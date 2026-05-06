# Runbook — Polar webhook replay

**Severity:** S1 (degraded). Customer paid but did not receive a license.
**Owner:** maintainer (single-operator rotation, see `docs/SERVER_OBSERVABILITY.md` § Rotation).
**Related:** `docs/LICENSING_ADR.md` Decision 6 (webhook contract), `license-server/src/handlers/webhooks.ts`.

## Detection

The operator notices any of:

- Polar dashboard reports a delivery failure (Polar → Settings → Webhooks → Recent deliveries).
- Customer support email: "I paid but never got a license token".
- Log alert fires on `request.completed { route: 'webhooks.polar', errorClass: 'client' }` rate spike.
- Synthetic monitor fires on `request.completed { route: 'webhooks.polar', status: 5xx }` for >0% over 1h.

## Mitigation

Polar webhooks are **idempotent** — replaying a successful delivery is safe; the handler dedupes by `polar_order_id` in D1. Replay procedure:

1. Pull the original webhook payload from Polar:
   - Polar dashboard → Webhooks → click the failed delivery → "Copy payload" + "Copy signature header".
2. Sanity-check the payload's `customer.email` matches the customer ticket.
3. Replay against the production worker:
   ```bash
   curl -X POST https://licenses.linguacode.dev/webhooks/polar \
     -H "polar-signature: <sig from dashboard>" \
     -H "Content-Type: application/json" \
     -d @payload.json
   ```
4. Tail logs in a second terminal to confirm:
   ```bash
   wrangler tail --format=pretty | grep -E '"route":"webhooks.polar"'
   ```
   - Success: `"event":"request.completed"` with `"route":"webhooks.polar"` and `"status":200`.
   - Idempotent retry: same request envelope with `"status":200`; D1 remains single-row because the handler dedupes by Polar id.
   - Failed: `"errorClass":"client"` with `"status":400` or `"status":401` → signature header or timestamp was wrong; recopy from dashboard.

## Rollback

Webhook replays are idempotent. If the replay landed but the customer still reports a missing license, the failure is downstream (Resend email delivery) — see `license-recovery.md` for the manual reissue path.

To revoke a license that was minted in error:

```sql
-- D1 console (wrangler d1 execute lingua-licenses --command)
UPDATE licenses
   SET status = 'revoked', updated_at = strftime('%s', 'now') * 1000
 WHERE polar_order_id = '<order_id>';
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

1. D1 row exists: `SELECT id, status, issued_to FROM licenses WHERE polar_order_id = '<order_id>';` should return one row with `status = 'active'`.
2. Email delivery: check Resend dashboard for the outbound message to `<customer_email>`.
3. Customer confirms receipt + activation in the desktop app.
