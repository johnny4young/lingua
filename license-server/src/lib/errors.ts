/**
 * Tagged-union error responses.
 *
 * Every endpoint in the worker returns one of two shapes:
 *
 *   { ok: true,  ...payload }
 *   { ok: false, reason: <code>, message?: string, issues?: string[] }
 *
 * The renderer's `licenseStore` already handles tagged-union failure
 * shapes from the IPC bridge (Slice 0); using the same convention on the
 * HTTP surface means Slice 2's wiring code can pass server responses
 * straight through without re-mapping.
 *
 * `reason` codes used in Slice 1:
 *   - 'invalid-input'      — body shape failed validation (400)
 *   - 'method-not-allowed' — HTTP verb mismatch on a known route (405)
 *   - 'not-found'          — unknown route (404)
 *   - 'not-implemented'    — endpoint scaffolded but Polar/D1 wiring
 *                            still pending Slice 2 (501)
 *
 * Slice 2 will add 'exhausted', 'expired', 'invalid-signature',
 * 'unknown-license', 'rate-limited', and friends. They land on this same
 * shape so the renderer fallback chain stays uniform.
 */

import { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import { jsonNoStore } from './json';

export type ErrorReason =
  | 'invalid-input'
  | 'method-not-allowed'
  | 'not-found'
  | 'not-implemented';

export interface ErrorBody {
  ok: false;
  reason: ErrorReason;
  message?: string;
  issues?: string[];
}

const STATUS_BY_REASON: Record<ErrorReason, StatusCode> = {
  'invalid-input': 400,
  'method-not-allowed': 405,
  'not-found': 404,
  'not-implemented': 501,
};

export function errorResponse(
  c: Context,
  reason: ErrorReason,
  options: { message?: string; issues?: string[] } = {},
): Response {
  const body: ErrorBody = { ok: false, reason };
  if (options.message !== undefined) body.message = options.message;
  if (options.issues !== undefined) body.issues = options.issues;
  return jsonNoStore(c, body, STATUS_BY_REASON[reason] as number);
}

export function methodNotAllowedResponse(
  c: Context,
  allowedMethods: readonly string[],
): Response {
  const response = errorResponse(c, 'method-not-allowed', {
    message: `${c.req.method} is not allowed for ${c.req.path}`,
  });
  response.headers.set('Allow', allowedMethods.join(', '));
  return response;
}

/** Slice 1 placeholder for endpoints that exist but defer real work to Slice 2. */
export function notImplementedResponse(c: Context, message: string): Response {
  return errorResponse(c, 'not-implemented', { message });
}
