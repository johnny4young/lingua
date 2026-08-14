# Runbook — refund / refunded license deactivation

**Severity:** S2 (operational). License must be deactivated promptly to honor refund.
**Owner:** maintainer.
**Related:** `license-server/src/handlers/webhooks.ts`, Lemon Squeezy `order_refunded` webhook contract.

## Detection

- Lemon Squeezy refund webhook fires (`order_refunded`; a cancelled subscription arrives as `subscription_cancelled`).
- Log signal: `request.completed { route: 'webhooks.lemonsqueezy', status: 200 }` around the refund delivery timestamp, plus the D1 license row changing to `refunded`.
- Customer support email: "I want to cancel my purchase / I requested a refund".

The webhook handler auto-deactivates licenses for `order_refunded` events. Subscription licenses store the originating `order_id` captured at `subscription_created`, so a refund of that order revokes them through the same path. Manual intervention is only required when the webhook missed (rare — see `webhook-replay.md`) or when the customer disputes the refund.

## Mitigation

### Path A — automatic (default)

When the webhook fires successfully, the handler:

1. Looks up the license by `merchant_order_id`.
2. Sets `licenses.status = 'refunded'` in D1.
3. Emits a `request.completed` envelope for `route = 'webhooks.lemonsqueezy'`.

Device rows are intentionally left in place: activation and status checks
gate on `licenses.status`, so a refunded license cannot activate anything
regardless of its device list. Clearing `devices.removed_at` is optional
manual hygiene (Path B includes the SQL).

The desktop client polls `licenses/status` every 24h; the web build polls every 30 minutes. After the next poll, the user's app surface flips to the Free tier.

### Path B — manual override

If Lemon Squeezy reports a refund but the webhook didn't auto-process (D1 still shows `active`):

1. Verify the refund in the Lemon Squeezy dashboard (Store → Orders → search by customer email).
2. Replay the webhook per `webhook-replay.md`. If replay still doesn't deactivate, manually update D1:

   ```sql
   UPDATE licenses
      SET status = 'refunded', updated_at = strftime('%s', 'now')
    WHERE merchant_order_id = '<order_id>';

   UPDATE devices
      SET removed_at = strftime('%s', 'now')
    WHERE license_id = '<license_id>'
      AND removed_at IS NULL;
   ```

3. Tail logs to confirm no further activation attempts succeed for that license:
   ```bash
   wrangler tail --format=pretty | grep '"licenseId":"<license_id>"'
   ```

### Path C — disputed refund

If the customer disputes the refund (paid via card, refund processed by Lemon Squeezy, but customer claims they didn't request it):

1. Capture the refund record in the Lemon Squeezy dashboard (Store → Orders → original order).
2. Do NOT re-issue the license without payment confirmation. The refund is already settled by the bank.
3. Direct the customer to re-purchase if they want continued access.

## Rollback

If the deactivation was triggered in error (e.g., wrong customer email matched), reverse it:

```sql
UPDATE licenses
   SET status = 'active', updated_at = strftime('%s', 'now')
 WHERE id = '<license_id>'
   AND merchant_order_id = '<order_id>';
```

Re-issue the device list only when the customer requests it (devices stay `removed_at`-stamped; the user can re-pair on next launch).

## Customer-support note

Template reply (English):

```
Hi <name>,

We've confirmed the refund (order <order_id>). Your Lingua license
has been deactivated; the desktop app will switch to the Free tier
on its next license check (within 24 hours).

If you want to restore access, you can re-purchase at
https://linguacode.dev/pricing.

— Lingua support
```

## Validation

1. `licenses.status` for the revoked token returns `{ ok: false, reason: 'refunded' }`.
2. The next `licenses.activate` attempt with the same token is rejected — no double-activation.
3. The Lemon Squeezy order shows `refunded: true` matching D1's `licenses.status: 'refunded'` for the same `merchant_order_id`.
