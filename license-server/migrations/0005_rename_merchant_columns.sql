-- Migration 0005 — merchant-neutral provenance columns.
--
-- The payments provider moved from Polar to Lemon Squeezy (2026-08-13
-- decision: centralize every product on LS). The columns that record
-- which merchant order/subscription minted a license were named after
-- Polar; rename them to provider-neutral names so the NEXT merchant
-- change is a webhook-handler swap with no schema churn.
--
-- Safe to run in place: there are no production sales rows, and SQLite
-- RENAME COLUMN rewrites index definitions automatically. The index is
-- dropped and recreated only to shed its polar_* NAME.

ALTER TABLE licenses RENAME COLUMN polar_order_id TO merchant_order_id;
ALTER TABLE licenses RENAME COLUMN polar_subscription_id TO merchant_subscription_id;

DROP INDEX IF EXISTS licenses_polar_subscription_idx;
CREATE INDEX IF NOT EXISTS licenses_merchant_subscription_idx
  ON licenses(merchant_subscription_id);
