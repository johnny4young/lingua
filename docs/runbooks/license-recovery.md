# Runbook — manual license recovery

**Severity:** S1 (degraded). Customer has paid but cannot find their license token.
**Owner:** maintainer.
**Related:** `license-server/src/handlers/recover.ts`, `webhook-replay.md` (try replay first).

## Detection

- Customer support email: "I paid weeks ago and lost my activation email".
- Email-deliverability dashboard shows hard-bounce against the customer's address.
- Resend dashboard shows failed / rejected delivery rate over 5% in 1h, or logs show `request.completed { route: 'licenses.recover.start', errorClass: 'server' | 'upstream' }`.

Recovery is the last-resort surface; if the webhook replay path (`webhook-replay.md`) didn't fix it (license already exists in D1 but the email never landed), come here.

## Mitigation

The `licenses/recover/start` handler accepts an email address, looks up active licenses for that email in D1, and re-sends the activation email via Resend. Two paths:

### Path A — customer-driven (preferred)

Direct the customer to the in-app recovery flow:

1. Open Lingua → Settings → License → "Recover license" (web build) / "Resend activation email" (desktop).
2. Enter the email used at purchase.
3. Wait up to 5 minutes for the email; check spam.

If this works, the operator does nothing further.

### Path B — operator-driven (when path A is blocked)

Reasons path A is blocked: customer's email provider rejects Resend mail (corporate spam filter); customer typoed the email at purchase; customer no longer has access to the original mailbox.

1. Verify the customer's identity. Confirm Polar order id (from their receipt) or last 4 of the card used.
2. Look up the license:
   ```bash
   wrangler d1 execute lingua-licenses --command \
     "SELECT id, issued_to, tier, status FROM licenses WHERE issued_to = '<email>' OR polar_order_id = '<order_id>';"
   ```
3. If the customer wants the token sent to a new email, update `issued_to` first:
   ```sql
   UPDATE licenses SET issued_to = '<new_email>', updated_at = strftime('%s', 'now') * 1000
    WHERE id = '<license_id>';
   ```
4. Trigger the recovery handler manually:
   ```bash
   curl -X POST https://licenses.linguacode.dev/licenses/recover/start \
     -H "Content-Type: application/json" \
     -d '{"email":"<new_email>"}'
   ```
5. Tail logs to confirm the email send:
   ```bash
   wrangler tail --format=pretty | grep -E '"route":"licenses\.recover'
   ```
   Expect a `request.completed` envelope with `"route":"licenses.recover.start"` and `"status":200`. Then verify actual delivery in Resend, because the Worker does not emit per-email success events today.

## Rollback

If the recovery email was sent to the wrong address, revoke the **just-issued** confirmation token (not the underlying license):

```sql
UPDATE pending_confirmations SET expires_at = 0
 WHERE email = '<wrong_email>'
   AND created_at > (strftime('%s', 'now') * 1000 - 600000);
```

This invalidates the recovery link without touching the underlying license. The customer can re-trigger recovery once the email is corrected.

## Customer-support note

Template reply (English):

```
Hi <name>,

I've manually re-sent your Lingua license activation email to <email>.
You should see it within 5 minutes; please check spam.

If it still doesn't arrive, reply with the alternative email address
you'd like the license sent to and we'll re-route it.

— Lingua support
```

## Validation

1. Customer confirms email receipt.
2. Customer activates in the app — `request.completed` log line emitted with `"route":"licenses.activate"` and `"status":200`.
3. `licenses/status` returns `{ ok: true, status: 'active' }` for the customer's token.

## Privacy notes

- Never log the full activation token. The structured logger redacts `token`, `signature`, and `htmlBody` automatically — but if you copy-paste payloads into incident notes, manually scrub these fields.
- D1 stores the token hash, not the token itself, on activation; the raw token only appears in transit.
