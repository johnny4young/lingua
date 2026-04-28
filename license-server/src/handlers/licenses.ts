/**
 * License lifecycle endpoints — RL-061 Slice 2.
 *
 *   POST /licenses/activate         register a device (per-surface) on a verified license
 *   GET  /licenses/status           snapshot + refreshedToken when newer
 *   POST /licenses/devices/remove   soft-delete a device on the same license
 *
 * Surface-aware: every devices counter is `WHERE surface = ?` so the
 * 2026-04-26 design lock split-bucket device limit (3 desktop + 3 web)
 * works correctly. Activate counts the requested surface; status
 * groups devices by surface; remove is surface-agnostic since
 * `(license_id, device_id)` is unique cross-surface in the schema.
 */

import { Hono } from 'hono';
import { errorResponse, methodNotAllowedResponse } from '../lib/errors';
import { jsonNoStore } from '../lib/json';
import {
  validateDeviceRemoveBody,
  validateLicenseActivateBody,
  validateLicenseStatusRequest,
  type Surface,
} from '../lib/validation';
import { verifyLicenseToken, type LicensePayload } from '../lib/sign';
import {
  countActiveDevices,
  findDeviceByLicenseAndId,
  findLicenseById,
  findLicenseByToken,
  insertDevice,
  listAllActiveDevices,
  markDeviceRemoved,
  touchDeviceLastSeen,
  type DeviceRow,
  type LicenseRow,
} from '../lib/db';
import type { Env } from '../index';

export const licensesRouter = new Hono<{ Bindings: Env }>();

/** Mirrors `DEFAULT_GRACE_PERIOD_MS = 14 days` in `src/shared/license.ts`. */
const GRACE_SECONDS = 14 * 24 * 60 * 60;

// -------------------------------------------- POST /licenses/activate

licensesRouter.post('/activate', async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return errorResponse(c, 'invalid-input', { message: 'body must be valid JSON' });
  }
  const validation = validateLicenseActivateBody(raw);
  if (!validation.ok) {
    return errorResponse(c, 'invalid-input', { issues: validation.issues });
  }
  const { token, deviceId, deviceName, os, surface } = validation.value;

  const verifyOutcome = await verifyTokenAgainstEnv(c.env, token);
  if (!verifyOutcome.ok) return verifyOutcome.response;

  const license = verifyOutcome.license;
  if (license.status === 'refunded') {
    return jsonResponse({ ok: false, reason: 'license-refunded' }, 401);
  }
  if (isHardExpired(license)) {
    return jsonResponse({ ok: false, reason: 'license-expired' }, 401);
  }

  // Idempotent activation: same device + surface already registered.
  const existing = await findDeviceByLicenseAndId(c.env.DB, license.id, deviceId, surface);
  if (existing && existing.removed_at === null) {
    await touchDeviceLastSeen(c.env.DB, existing.id);
    const allDevices = await listAllActiveDevices(c.env.DB, license.id);
    return jsonNoStore(c, {
      ok: true,
      licenseId: license.id,
      activated: false,
      idempotent: true,
      devices: groupDevicesBySurface(allDevices),
      deviceLimit: { desktop: license.device_limit, web: license.device_limit },
    });
  }

  // Bucket-aware count.
  const activeCount = await countActiveDevices(c.env.DB, license.id, surface);
  if (activeCount >= license.device_limit) {
    const allDevices = await listAllActiveDevices(c.env.DB, license.id);
    return jsonNoStore(c, {
      ok: false,
      reason: 'exhausted',
      surface,
      devices: groupDevicesBySurface(allDevices),
      deviceLimit: { desktop: license.device_limit, web: license.device_limit },
    });
  }

  if (existing) {
    // Reactivate via update — keeps history compact for users who
    // remove + re-add the same machine.
    await c.env.DB.prepare(
      `UPDATE devices SET removed_at = NULL, last_seen_at = ?, device_name = ?, os = ?
       WHERE id = ?`
    )
      .bind(Math.floor(Date.now() / 1000), deviceName, os, existing.id)
      .run();
  } else {
    await insertDevice(c.env.DB, {
      id: crypto.randomUUID(),
      licenseId: license.id,
      deviceId,
      deviceName,
      os,
      surface,
    });
  }

  const allDevices = await listAllActiveDevices(c.env.DB, license.id);
  return jsonNoStore(c, {
    ok: true,
    licenseId: license.id,
    activated: true,
    idempotent: false,
    devices: groupDevicesBySurface(allDevices),
    deviceLimit: { desktop: license.device_limit, web: license.device_limit },
  });
});

licensesRouter.all('/activate', (c) => methodNotAllowedResponse(c, ['POST']));

// ------------------------------------------------ GET /licenses/status

licensesRouter.get('/status', async (c) => {
  const authorization = c.req.header('authorization') ?? null;
  const params = new URLSearchParams();
  const deviceId = c.req.query('deviceId');
  const surface = c.req.query('surface');
  if (typeof deviceId === 'string') params.set('deviceId', deviceId);
  if (typeof surface === 'string') params.set('surface', surface);

  const validation = validateLicenseStatusRequest(authorization, params);
  if (!validation.ok) {
    return errorResponse(c, 'invalid-input', { issues: validation.issues });
  }
  const { token, deviceId: requestedDeviceId, surface: requestedSurface } = validation.value;

  const verifyOutcome = await verifyTokenAgainstEnv(c.env, token);
  if (!verifyOutcome.ok) return verifyOutcome.response;

  const license = verifyOutcome.license;
  const allDevices = await listAllActiveDevices(c.env.DB, license.id);

  const matchingDevice = allDevices.find(
    (device) => device.device_id === requestedDeviceId && device.surface === requestedSurface
  );
  if (matchingDevice) {
    await touchDeviceLastSeen(c.env.DB, matchingDevice.id);
  }

  // Include refreshedToken when the persisted token differs from the
  // one the client just sent — Monthly subscriptions pick up
  // `expires_at` extensions through this channel after a
  // `subscription.updated` webhook re-mints `licenses.token`.
  const refreshedToken = license.token !== token ? license.token : undefined;

  return jsonNoStore(c, {
    ok: true,
    licenseId: license.id,
    status: computeStatus(license),
    tier: license.tier,
    expiresAt: license.expires_at,
    supportWindowEndsAt: license.support_window_ends_at,
    devices: groupDevicesBySurface(allDevices),
    deviceLimit: { desktop: license.device_limit, web: license.device_limit },
    deviceRegistered: matchingDevice !== undefined,
    refreshedToken,
  });
});

licensesRouter.all('/status', (c) => methodNotAllowedResponse(c, ['GET']));

// -------------------------------------- POST /licenses/devices/remove

licensesRouter.post('/devices/remove', async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return errorResponse(c, 'invalid-input', { message: 'body must be valid JSON' });
  }
  const validation = validateDeviceRemoveBody(raw);
  if (!validation.ok) {
    return errorResponse(c, 'invalid-input', { issues: validation.issues });
  }
  const { token, deviceIdToRemove } = validation.value;

  const verifyOutcome = await verifyTokenAgainstEnv(c.env, token);
  if (!verifyOutcome.ok) return verifyOutcome.response;

  const license = verifyOutcome.license;
  const result = await markDeviceRemoved(c.env.DB, license.id, deviceIdToRemove);

  const allDevices = await listAllActiveDevices(c.env.DB, license.id);
  return jsonNoStore(c, {
    ok: true,
    licenseId: license.id,
    removed: result.affected > 0,
    devices: groupDevicesBySurface(allDevices),
    deviceLimit: { desktop: license.device_limit, web: license.device_limit },
  });
});

licensesRouter.all('/devices/remove', (c) => methodNotAllowedResponse(c, ['POST']));

// ----------------------------------------------------------------- helpers

interface VerifyOutcomeOk {
  ok: true;
  license: LicenseRow;
  payload: LicensePayload;
}
interface VerifyOutcomeErr {
  ok: false;
  response: Response;
}

async function verifyTokenAgainstEnv(
  env: Env,
  token: string
): Promise<VerifyOutcomeOk | VerifyOutcomeErr> {
  const publicKeyJwk = parseJwk(env.LINGUA_LICENSE_PUBLIC_KEY_JWK);
  if (!publicKeyJwk) {
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          reason: 'not-implemented',
          message: 'LINGUA_LICENSE_PUBLIC_KEY_JWK is not configured.',
        },
        501
      ),
    };
  }
  const verified = await verifyLicenseToken(token, publicKeyJwk);
  if (!verified.ok) {
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          reason: verified.reason === 'invalid-signature' ? 'invalid-signature' : 'invalid-token',
          message: verified.message,
        },
        401
      ),
    };
  }

  const license = await findCurrentLicenseForToken(env.DB, token, verified.payload);
  if (!license) {
    return {
      ok: false,
      response: jsonResponse(
        { ok: false, reason: 'unknown-license', message: 'Token is valid but not in D1.' },
        401
      ),
    };
  }
  return { ok: true, license, payload: verified.payload };
}

async function findCurrentLicenseForToken(
  db: Env['DB'],
  token: string,
  payload: LicensePayload
): Promise<LicenseRow | null> {
  const currentTokenRow = await findLicenseByToken(db, token);
  if (currentTokenRow) return currentTokenRow;

  if (!payload.licenseId) return null;
  const row = await findLicenseById(db, payload.licenseId);
  if (!row) return null;

  // A refreshed token replaces `licenses.token`. The older signed token
  // is still trustworthy if it names the same row and stable buyer/SKU.
  if (
    row.product_id !== payload.productId ||
    row.issued_to !== payload.issuedTo.toLowerCase().trim()
  ) {
    return null;
  }
  return row;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function parseJwk(raw: string | undefined): JsonWebKey | null {
  if (!raw || raw.length === 0) return null;
  try {
    return JSON.parse(raw) as JsonWebKey;
  } catch {
    return null;
  }
}

function computeStatus(
  license: LicenseRow
): 'active' | 'grace' | 'expired' | 'cancel_at_period_end' | 'refunded' {
  if (license.status === 'refunded') return 'refunded';
  if (license.expires_at === null) return 'active';
  const now = Math.floor(Date.now() / 1000);
  if (license.status === 'cancel_at_period_end' && now <= license.expires_at) {
    return 'cancel_at_period_end';
  }
  if (now <= license.expires_at) return 'active';
  if (now <= license.expires_at + GRACE_SECONDS) return 'grace';
  return 'expired';
}

function isHardExpired(license: LicenseRow): boolean {
  if (license.expires_at === null) return false;
  const now = Math.floor(Date.now() / 1000);
  return now > license.expires_at + GRACE_SECONDS;
}

interface PublicDeviceShape {
  id: string;
  deviceId: string;
  deviceName: string;
  os: string;
  surface: Surface;
  activatedAt: number;
  lastSeenAt: number;
}

function groupDevicesBySurface(rows: DeviceRow[]): {
  desktop: PublicDeviceShape[];
  web: PublicDeviceShape[];
} {
  const grouped: { desktop: PublicDeviceShape[]; web: PublicDeviceShape[] } = {
    desktop: [],
    web: [],
  };
  for (const row of rows) {
    const shape: PublicDeviceShape = {
      id: row.id,
      deviceId: row.device_id,
      deviceName: row.device_name,
      os: row.os,
      surface: row.surface,
      activatedAt: row.activated_at,
      lastSeenAt: row.last_seen_at,
    };
    if (row.surface === 'web') grouped.web.push(shape);
    else grouped.desktop.push(shape);
  }
  return grouped;
}
