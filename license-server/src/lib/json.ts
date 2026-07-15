/**
 * JSON response helpers shared across handlers.
 *
 * `jsonResponse` matches the small surface from `update-server/src/index.ts`
 * but adds `Cache-Control: no-store` for license-server endpoints — none
 * of these are cacheable, and a stale 501 from a Slice 1 deploy held in a
 * CDN cache after Slice 2 ships would silently break activation.
 * RL-141 also stamps the versioned `/licenses/*` and `/trials/*` contract
 * here so success, validation, method, not-found, and internal errors cannot
 * drift independently.
 */

import { Context } from 'hono';
import { stampLicenseServerProtocol } from './protocol';

export function jsonNoStore<T>(c: Context, body: T, status = 200): Response {
  const responseBody = stampLicenseServerProtocol(c.req.path, body);
  return c.json(responseBody as Record<string, unknown>, status as 200, {
    'Cache-Control': 'no-store',
  });
}
