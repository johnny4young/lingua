/**
 * GET /health — liveness check.
 *
 * Real handler (not a stub). Returns 200 with a minimal payload that the
 * uptime monitor / smoke tests can assert against. No D1 query, no
 * external calls — must succeed even if Polar / Resend / D1 are down so
 * the maintainer can distinguish "worker is up but D1 is broken" from
 * "worker is down".
 */

import { Hono } from 'hono';
import { jsonNoStore } from '../lib/json';
import { methodNotAllowedResponse } from '../lib/errors';

export const SERVER_NAME = 'lingua-license-server';
export const SERVER_VERSION = '0.1.0';

export const healthRouter = new Hono();

healthRouter.get('/', (c) =>
  jsonNoStore(c, {
    ok: true,
    server: SERVER_NAME,
    version: SERVER_VERSION,
  }),
);

healthRouter.all('/', (c) => methodNotAllowedResponse(c, ['GET']));
