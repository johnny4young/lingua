/**
 * POST /trials/start — Slice 1 stub.
 *
 * Validates the request body shape so Slice 2 can drop in the real
 * minting + Resend email + KV rate-limit code without revisiting the
 * request contract. Returns 501 (`not-implemented`) for valid bodies
 * and 400 (`invalid-input`) for malformed ones.
 *
 * Body shape (validated in `lib/validation.ts`):
 *   { email, deviceId, deviceName, os }
 *
 * Real Slice 2 behaviour (not implemented yet):
 *   - lower-case email, trim deviceId/deviceName
 *   - reject if email already has a trial in `trials.email`
 *   - reject if device_id already has a trial in `trials.device_id`
 *   - rate-limit per-IP via Workers KV (3 trials/IP/day)
 *   - mint a tier='trial' license token (14 day expires_at), persist
 *     into `licenses` + `trials`, email via Resend, return the token.
 */

import { Hono } from 'hono';
import { errorResponse, methodNotAllowedResponse, notImplementedResponse } from '../lib/errors';
import { validateTrialStartBody } from '../lib/validation';

export const trialsRouter = new Hono();

trialsRouter.post('/start', async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return errorResponse(c, 'invalid-input', { message: 'body must be valid JSON' });
  }

  const validation = validateTrialStartBody(raw);
  if (!validation.ok) {
    return errorResponse(c, 'invalid-input', { issues: validation.issues });
  }

  return notImplementedResponse(
    c,
    'Trial endpoint scaffolded. Polar/Resend/KV wiring pending Slice 2.',
  );
});

trialsRouter.all('/start', (c) => methodNotAllowedResponse(c, ['POST']));
