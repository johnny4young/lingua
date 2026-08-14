-- Migration 0005 — merchant-neutral provenance columns + uniqueness.
--
-- The payments provider moved from Polar to Lemon Squeezy (2026-08-13
-- decision: centralize every product on LS). The columns that record
-- which merchant order/subscription minted a license were named after
-- Polar; rename them to provider-neutral names so the NEXT merchant
-- change is a webhook-handler swap with no schema churn.
--
-- The replacement indexes are UNIQUE on purpose: these ids are the
-- entire replay/idempotency defense (Lemon Squeezy signs no timestamp),
-- and the handler's find-then-insert has a race window under concurrent
-- deliveries of the same event. A UNIQUE constraint turns that race
-- into a constraint error on the second insert instead of a double
-- mint. SQLite treats NULLs as distinct in unique indexes, so trial and
-- education rows (which carry neither id) are unaffected.
--
-- Safe to run in place: there are no production sales rows, and SQLite
-- RENAME COLUMN rewrites index definitions automatically. The old index
-- is dropped to shed both its polar_* name and its non-unique shape.

ALTER TABLE licenses RENAME COLUMN polar_order_id TO merchant_order_id;
ALTER TABLE licenses RENAME COLUMN polar_subscription_id TO merchant_subscription_id;

DROP INDEX IF EXISTS licenses_polar_subscription_idx;
CREATE UNIQUE INDEX IF NOT EXISTS licenses_merchant_subscription_uidx
  ON licenses(merchant_subscription_id);
CREATE UNIQUE INDEX IF NOT EXISTS licenses_merchant_order_uidx
  ON licenses(merchant_order_id);
