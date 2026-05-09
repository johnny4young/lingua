/**
 * D1 query helpers.
 *
 * Typed thin wrappers around the `D1Database` binding. Hand-rolled
 * (no Drizzle / Kysely / Prisma) because the schema has 3 tables and
 * a half-dozen queries — the abstraction tax of an ORM exceeds the
 * complexity it would hide.
 *
 * Surface-aware: every query that touches `devices` accepts the
 * `surface` field so the split-bucket `device_limit` from the
 * 2026-04-26 design lock works correctly. Counting `WHERE surface = ?`
 * is the only place the bucket separation lives — once the SQL
 * uses it, the rest of the app falls into place.
 */

import type { D1Database } from '@cloudflare/workers-types';

export type Surface = 'desktop' | 'web';

export type LicenseStatus = 'active' | 'cancel_at_period_end' | 'refunded' | 'expired';

export interface LicenseRow {
  id: string;
  token: string;
  product_id: string;
  tier: string;
  device_limit: number;
  issued_to: string;
  issued_at: number;
  expires_at: number | null;
  support_window_ends_at: number | null;
  status: LicenseStatus;
  polar_order_id: string | null;
  polar_subscription_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface DeviceRow {
  id: string;
  license_id: string;
  device_id: string;
  device_name: string;
  os: string;
  surface: Surface;
  activated_at: number;
  last_seen_at: number;
  removed_at: number | null;
}

export interface InsertLicenseInput {
  id: string;
  token: string;
  productId: string;
  tier: string;
  deviceLimit: number;
  issuedTo: string;
  issuedAt: number;
  expiresAt: number | null;
  supportWindowEndsAt: number | null;
  status: LicenseStatus;
  polarOrderId: string | null;
  polarSubscriptionId: string | null;
}

export async function insertLicense(db: D1Database, input: InsertLicenseInput): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO licenses (
        id, token, product_id, tier, device_limit, issued_to,
        issued_at, expires_at, support_window_ends_at, status,
        polar_order_id, polar_subscription_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.id,
      input.token,
      input.productId,
      input.tier,
      input.deviceLimit,
      input.issuedTo.toLowerCase().trim(),
      input.issuedAt,
      input.expiresAt,
      input.supportWindowEndsAt,
      input.status,
      input.polarOrderId,
      input.polarSubscriptionId,
      now,
      now
    )
    .run();
}

export async function findLicenseByToken(
  db: D1Database,
  token: string
): Promise<LicenseRow | null> {
  return db
    .prepare(`SELECT * FROM licenses WHERE token = ? LIMIT 1`)
    .bind(token)
    .first<LicenseRow>();
}

export async function findLicenseById(
  db: D1Database,
  id: string
): Promise<LicenseRow | null> {
  return db
    .prepare(`SELECT * FROM licenses WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<LicenseRow>();
}

export async function findLicenseByPolarSubscription(
  db: D1Database,
  subscriptionId: string
): Promise<LicenseRow | null> {
  return db
    .prepare(`SELECT * FROM licenses WHERE polar_subscription_id = ? LIMIT 1`)
    .bind(subscriptionId)
    .first<LicenseRow>();
}

export async function findLicenseByPolarOrder(
  db: D1Database,
  orderId: string
): Promise<LicenseRow | null> {
  return db
    .prepare(`SELECT * FROM licenses WHERE polar_order_id = ? LIMIT 1`)
    .bind(orderId)
    .first<LicenseRow>();
}

/**
 * Refresh the token + expires_at + support_window_ends_at on a
 * subscription.updated event. Bumps `updated_at` so the renderer's
 * `/licenses/status` knows there's a `refreshedToken` waiting.
 */
export async function refreshLicenseToken(
  db: D1Database,
  licenseId: string,
  newToken: string,
  expiresAt: number | null,
  supportWindowEndsAt: number | null
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE licenses SET token = ?, expires_at = ?, support_window_ends_at = ?,
       status = 'active', updated_at = ? WHERE id = ?`
    )
    .bind(newToken, expiresAt, supportWindowEndsAt, now, licenseId)
    .run();
}

export async function setLicenseStatus(
  db: D1Database,
  licenseId: string,
  status: LicenseStatus
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE licenses SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(status, now, licenseId)
    .run();
}

export interface InsertDeviceInput {
  id: string;
  licenseId: string;
  deviceId: string;
  deviceName: string;
  os: string;
  surface: Surface;
}

export async function insertDevice(db: D1Database, input: InsertDeviceInput): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO devices (
        id, license_id, device_id, device_name, os, surface,
        activated_at, last_seen_at, removed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .bind(
      input.id,
      input.licenseId,
      input.deviceId,
      input.deviceName,
      input.os,
      input.surface,
      now,
      now
    )
    .run();
}

export async function findDeviceByLicenseAndId(
  db: D1Database,
  licenseId: string,
  deviceId: string,
  surface: Surface
): Promise<DeviceRow | null> {
  return db
    .prepare(
      `SELECT * FROM devices WHERE license_id = ? AND device_id = ? AND surface = ? LIMIT 1`
    )
    .bind(licenseId, deviceId, surface)
    .first<DeviceRow>();
}

export async function listActiveDevices(
  db: D1Database,
  licenseId: string,
  surface: Surface
): Promise<DeviceRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM devices WHERE license_id = ? AND surface = ? AND removed_at IS NULL
       ORDER BY activated_at ASC`
    )
    .bind(licenseId, surface)
    .all<DeviceRow>();
  return result.results ?? [];
}

export async function listAllActiveDevices(
  db: D1Database,
  licenseId: string
): Promise<DeviceRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM devices WHERE license_id = ? AND removed_at IS NULL
       ORDER BY surface ASC, activated_at ASC`
    )
    .bind(licenseId)
    .all<DeviceRow>();
  return result.results ?? [];
}

export async function countActiveDevices(
  db: D1Database,
  licenseId: string,
  surface: Surface
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM devices
       WHERE license_id = ? AND surface = ? AND removed_at IS NULL`
    )
    .bind(licenseId, surface)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function insertDeviceIfSlotAvailable(
  db: D1Database,
  input: InsertDeviceInput,
  deviceLimit: number
): Promise<{ affected: number }> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(
      `INSERT INTO devices (
        id, license_id, device_id, device_name, os, surface,
        activated_at, last_seen_at, removed_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL
      WHERE (
        SELECT COUNT(*) FROM devices
        WHERE license_id = ? AND surface = ? AND removed_at IS NULL
      ) < ?
      AND NOT EXISTS (
        SELECT 1 FROM devices
        WHERE license_id = ? AND device_id = ? AND surface = ? AND removed_at IS NULL
      )`
    )
    .bind(
      input.id,
      input.licenseId,
      input.deviceId,
      input.deviceName,
      input.os,
      input.surface,
      now,
      now,
      input.licenseId,
      input.surface,
      deviceLimit,
      input.licenseId,
      input.deviceId,
      input.surface
    )
    .run();
  return { affected: result.meta?.changes ?? 0 };
}

export async function reactivateDeviceIfSlotAvailable(
  db: D1Database,
  deviceRowId: string,
  licenseId: string,
  surface: Surface,
  deviceName: string,
  os: string,
  deviceLimit: number
): Promise<{ affected: number }> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(
      `UPDATE devices SET removed_at = NULL, last_seen_at = ?, device_name = ?, os = ?
       WHERE id = ? AND removed_at IS NOT NULL
       AND (
         SELECT COUNT(*) FROM devices
         WHERE license_id = ? AND surface = ? AND removed_at IS NULL
       ) < ?`
    )
    .bind(now, deviceName, os, deviceRowId, licenseId, surface, deviceLimit)
    .run();
  return { affected: result.meta?.changes ?? 0 };
}

export async function touchDeviceLastSeen(
  db: D1Database,
  deviceRowId: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE devices SET last_seen_at = ? WHERE id = ?`)
    .bind(now, deviceRowId)
    .run();
}

export async function markDeviceRemoved(
  db: D1Database,
  licenseId: string,
  deviceId: string
): Promise<{ affected: number }> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(
      `UPDATE devices SET removed_at = ?
       WHERE license_id = ? AND device_id = ? AND removed_at IS NULL`
    )
    .bind(now, licenseId, deviceId)
    .run();
  return { affected: result.meta?.changes ?? 0 };
}

// =============================================================== Slice 4

// ------------------------------------------------------ trials (Slice 4)

export interface TrialRow {
  id: string;
  email: string;
  device_id: string;
  license_id: string;
  issued_at: number;
}

export async function findTrialByEmail(
  db: D1Database,
  email: string
): Promise<TrialRow | null> {
  return (await db
    .prepare(`SELECT * FROM trials WHERE email = ? LIMIT 1`)
    .bind(email)
    .first<TrialRow>()) ?? null;
}

export async function findTrialByDeviceId(
  db: D1Database,
  deviceId: string
): Promise<TrialRow | null> {
  return (await db
    .prepare(`SELECT * FROM trials WHERE device_id = ? LIMIT 1`)
    .bind(deviceId)
    .first<TrialRow>()) ?? null;
}

export interface InsertTrialInput {
  id: string;
  email: string;
  deviceId: string;
  licenseId: string;
  issuedAt: number;
}

export async function insertTrial(db: D1Database, input: InsertTrialInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO trials (id, email, device_id, license_id, issued_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(input.id, input.email, input.deviceId, input.licenseId, input.issuedAt)
    .run();
}

// -------------------------------------------------- educations (Slice 4)

export interface EducationRow {
  id: string;
  email: string;
  device_id: string;
  license_id: string;
  issued_at: number;
}

export async function findEducationByEmail(
  db: D1Database,
  email: string
): Promise<EducationRow | null> {
  return (await db
    .prepare(`SELECT * FROM educations WHERE email = ? LIMIT 1`)
    .bind(email)
    .first<EducationRow>()) ?? null;
}

export async function findEducationByDeviceId(
  db: D1Database,
  deviceId: string
): Promise<EducationRow | null> {
  return (await db
    .prepare(`SELECT * FROM educations WHERE device_id = ? LIMIT 1`)
    .bind(deviceId)
    .first<EducationRow>()) ?? null;
}

export interface InsertEducationInput {
  id: string;
  email: string;
  deviceId: string;
  licenseId: string;
  issuedAt: number;
}

export async function insertEducation(
  db: D1Database,
  input: InsertEducationInput
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO educations (id, email, device_id, license_id, issued_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(input.id, input.email, input.deviceId, input.licenseId, input.issuedAt)
    .run();
}

// -------------------------- education_pending_confirmations (Slice 4)

export interface EducationPendingRow {
  id: string;
  email: string;
  device_id: string;
  device_name: string;
  os: string;
  created_at: number;
  expires_at: number;
  confirmed_at: number | null;
}

export interface InsertEducationPendingInput {
  id: string;
  email: string;
  deviceId: string;
  deviceName: string;
  os: string;
  createdAt: number;
  expiresAt: number;
}

export async function insertEducationPending(
  db: D1Database,
  input: InsertEducationPendingInput
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO education_pending_confirmations
         (id, email, device_id, device_name, os, created_at, expires_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .bind(
      input.id,
      input.email,
      input.deviceId,
      input.deviceName,
      input.os,
      input.createdAt,
      input.expiresAt
    )
    .run();
}

export async function findEducationPendingById(
  db: D1Database,
  id: string
): Promise<EducationPendingRow | null> {
  return (await db
    .prepare(`SELECT * FROM education_pending_confirmations WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<EducationPendingRow>()) ?? null;
}

export async function markEducationPendingConfirmed(
  db: D1Database,
  id: string,
  confirmedAt: number
): Promise<{ affected: number }> {
  const result = await db
    .prepare(
      `UPDATE education_pending_confirmations
         SET confirmed_at = ?
       WHERE id = ? AND confirmed_at IS NULL`
    )
    .bind(confirmedAt, id)
    .run();
  return { affected: result.meta?.changes ?? 0 };
}

// --------------------------- recovery_pending_confirmations (Slice 4)

export interface RecoveryPendingRow {
  id: string;
  email: string;
  created_at: number;
  expires_at: number;
  confirmed_at: number | null;
}

export interface InsertRecoveryPendingInput {
  id: string;
  email: string;
  createdAt: number;
  expiresAt: number;
}

export async function insertRecoveryPending(
  db: D1Database,
  input: InsertRecoveryPendingInput
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO recovery_pending_confirmations
         (id, email, created_at, expires_at, confirmed_at)
       VALUES (?, ?, ?, ?, NULL)`
    )
    .bind(input.id, input.email, input.createdAt, input.expiresAt)
    .run();
}

export async function findRecoveryPendingById(
  db: D1Database,
  id: string
): Promise<RecoveryPendingRow | null> {
  return (await db
    .prepare(`SELECT * FROM recovery_pending_confirmations WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<RecoveryPendingRow>()) ?? null;
}

export async function markRecoveryPendingConfirmed(
  db: D1Database,
  id: string,
  confirmedAt: number
): Promise<{ affected: number }> {
  const result = await db
    .prepare(
      `UPDATE recovery_pending_confirmations
         SET confirmed_at = ?
       WHERE id = ? AND confirmed_at IS NULL`
    )
    .bind(confirmedAt, id)
    .run();
  return { affected: result.meta?.changes ?? 0 };
}

// ------------------------------------------------ recovery email lookup

/**
 * Recovery looks up the canonical license row by email. `licenses`
 * has an `issued_to` column (lowercased on insert per
 * `tokens.ts:buildLicensePayload` + `db.ts:insertLicense`). We
 * intentionally prefer paid rows over Education, and Education over
 * Trial, when multiple rows share an email. A user who bought Pro and
 * later tried a free path should recover the paid token, not the newest
 * free token.
 */
export async function findLicenseByEmail(
  db: D1Database,
  email: string
): Promise<LicenseRow | null> {
  return (await db
    .prepare(
      `SELECT * FROM licenses
         WHERE issued_to = ?
         ORDER BY
           CASE
             WHEN tier IN ('pro', 'pro_lifetime', 'team') THEN 0
             WHEN tier = 'education' THEN 1
             WHEN tier = 'trial' THEN 2
             ELSE 3
           END ASC,
           created_at DESC
         LIMIT 1`
    )
    .bind(email)
    .first<LicenseRow>()) ?? null;
}
