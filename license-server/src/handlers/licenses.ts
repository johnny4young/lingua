/**
 * License endpoints — Slice 1 stubs.
 *
 *   POST /licenses/activate            — register a device against a license
 *   GET  /licenses/status              — refresh snapshot (with optional refreshedToken)
 *   POST /licenses/devices/remove      — soft-delete a device row
 *
 * All three validate request shape and return 501 (`not-implemented`).
 * The shapes match the LICENSING_ADR Decision 2 endpoint table and
 * Slice 2 will implement real D1 reads/writes against `licenses`,
 * `devices`, and the Ed25519 verifier.
 */

import { Hono } from 'hono';
import { errorResponse, methodNotAllowedResponse, notImplementedResponse } from '../lib/errors';
import {
  validateDeviceRemoveBody,
  validateLicenseActivateBody,
  validateLicenseStatusRequest,
} from '../lib/validation';

export const licensesRouter = new Hono();

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
  return notImplementedResponse(
    c,
    'License activation scaffolded. Polar webhook + D1 wiring pending Slice 2.',
  );
});

licensesRouter.all('/activate', (c) => methodNotAllowedResponse(c, ['POST']));

licensesRouter.get('/status', (c) => {
  // Token comes from Authorization: Bearer <token>, NOT from the URL —
  // CF observability + access logs capture query params verbatim and the
  // token is a credential. deviceId stays in the query because it is a
  // non-secret identifier the renderer needs to scope the lookup.
  const authorization = c.req.header('authorization') ?? null;
  const params = new URLSearchParams();
  const deviceId = c.req.query('deviceId');
  if (typeof deviceId === 'string') params.set('deviceId', deviceId);

  const validation = validateLicenseStatusRequest(authorization, params);
  if (!validation.ok) {
    return errorResponse(c, 'invalid-input', { issues: validation.issues });
  }
  return notImplementedResponse(
    c,
    'License status scaffolded. Verifier + D1 lookup pending Slice 2.',
  );
});

licensesRouter.all('/status', (c) => methodNotAllowedResponse(c, ['GET']));

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
  return notImplementedResponse(
    c,
    'Device removal scaffolded. Token verifier + D1 update pending Slice 2.',
  );
});

licensesRouter.all('/devices/remove', (c) => methodNotAllowedResponse(c, ['POST']));
