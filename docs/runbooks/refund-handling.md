# Runbook — refund / refunded license deactivation

**Severity:** S2 (operational). License must be deactivated promptly to honor refund.
**Owner:** maintainer.
**Related:** `license-server/src/handlers/webhooks.ts`, Polar refund webhook contract.

## Detection

- Polar refund webhook fires (`event: 'refund.created'` or `'subscription.canceled'` depending on tier).
- Log signal: `request.completed { route: 'webhooks.polar', status: 200 }` around the Polar refund delivery timestamp, plus the D1 license row changing to `revoked`.
- Customer support email: "I want to cancel my purchase / I requested a refund through Polar".

The Polar webhook handler auto-deactivates licenses for `refund.created` and `subscription.canceled` events. Manual intervention is only required when the webhook missed (rare — see `webhook-replay.md`) or when the customer disputes the refund.

## Mitigation

### Path A — automatic (default)

When the webhook fires successfully, the handler:

1. Looks up the license by `polar_order_id` or `polar_subscription_id`.
2. Sets `licenses.status = 'revoked'` in D1.
3. Sets `devices.removed_at = now()` for every device on that license.
4. Emits a `request.completed` envelope for `route = 'webhooks.polar'`.

The desktop client polls `licenses/status` every 24h; the web build polls every 30 minutes. After the next poll, the user's app surface flips to the Free tier.

### Path B — manual override

If Polar reports a refund but the webhook didn't auto-process (D1 still shows `active`):

1. Verify the refund in Polar dashboard (Polar → Orders → search by customer email).
2. Replay the webhook per `webhook-replay.md`. If replay still doesn't deactivate, manually update D1:
   ```sql
   UPDATE licenses
      SET status = 'revoked', updated_at = strftime('%s', 'now') * 1000
    WHERE polar_order_id = '<order_id>';

   UPDATE devices
      SET removed_at = strftime('%s', 'now') * 1000
    WHERE license_id = '<license_id>'
      AND removed_at IS NULL;
   ```
3. Tail logs to confirm no further activation attempts succeed for that license:
   ```bash
   wrangler tail --format=pretty | grep '"licenseId":"<license_id>"'
   ```

### Path C — disputed refund

If the customer disputes the refund (paid via card, refund processed by Polar, but customer claims they didn't request it):

1. Capture Polar's audit log for the refund (Polar → Orders → original order → "Refund history").
2. Do NOT re-issue the license without payment confirmation. The refund is already settled by the bank.
3. Direct the customer to re-purchase if they want continued access.

## Rollback

If the deactivation was triggered in error (e.g., wrong customer email matched), reverse it:

```sql
UPDATE licenses
   SET status = 'active', updated_at = strftime('%s', 'now') * 1000
 WHERE id = '<license_id>'
   AND polar_order_id = '<order_id>';
```

Re-issue the device list only when the customer requests it (devices stay `removed_at`-stamped; the user can re-pair on next launch).

## Customer-support note

Template reply (English):

```
Hi <name>,

We've confirmed the refund through Polar (order <order_id>). Your
Lingua license has been deactivated; the desktop app will switch
to the Free tier on its next license check (within 24 hours).

If you want to restore access, you can re-purchase at
https://linguacode.dev/pricing.

— Lingua support
```

## Validation

1. `licenses.status` for the revoked token returns `{ ok: false, reason: 'revoked' }`.
2. The next `licenses.activate` attempt with the same token returns `{ ok: false, reason: 'revoked' }` — no double-activation.
3. Polar order shows `status: 'refunded'` matches D1's `licenses.status: 'revoked'` for the same `polar_order_id`.
