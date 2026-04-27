/**
 * JSON response helpers shared across handlers.
 *
 * `jsonResponse` matches the small surface from `update-server/src/index.ts`
 * but adds `Cache-Control: no-store` for license-server endpoints — none
 * of these are cacheable, and a stale 501 from a Slice 1 deploy held in a
 * CDN cache after Slice 2 ships would silently break activation.
 */

import { Context } from 'hono';

export function jsonNoStore<T>(c: Context, body: T, status = 200): Response {
  return c.json(body as Record<string, unknown>, status as 200, {
    'Cache-Control': 'no-store',
  });
}
