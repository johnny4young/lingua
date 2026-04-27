/**
 * Lingua license-server (RL-061 Slice 1).
 *
 * Cloudflare Worker hosted at `licenses.linguacode.dev`. Sibling of the
 * `update-server/` worker (which proxies GitHub Releases for Squirrel).
 * Source-of-truth for license issuance, device tracking, trial minting,
 * and renewal token refresh — see docs/LICENSING_ADR.md Decision 2.
 *
 * Slice 1 ships the Hono router skeleton + D1 schema migration +
 * 501 stubs for every endpoint except /health. Slice 2 wires the Polar
 * webhook + Resend email + actual D1 writes; Slice 3 ships the
 * device-management UI in the Electron renderer; Slice 4 wires the
 * trial CTA; Slice 5 ships the release pipeline + web update banner.
 *
 * Every route returns the same tagged-union shape:
 *   { ok: true,  ...payload }
 *   { ok: false, reason, message?, issues? }
 *
 * matching the `licenseStore` IPC bridge contract from RL-059 Slice 0.
 */

import { Context, Hono } from 'hono';
import { errorResponse } from './lib/errors';
import { healthRouter } from './handlers/health';
import { licensesRouter } from './handlers/licenses';
import { trialsRouter } from './handlers/trials';
import { webhooksRouter } from './handlers/webhooks';
import { jsonNoStore } from './lib/json';

export interface Env {
  /**
   * D1 binding declared in wrangler.toml. Slice 1 does not query it
   * yet; Slice 2 wires `licenses`, `devices`, and `trials` reads/writes.
   */
  DB: D1Database;
}

export const app = new Hono<{ Bindings: Env }>();

/**
 * Tagged-union response for any unhandled throw. Exposed so tests can
 * exercise the contract without mounting a probe route on the live app
 * (Hono's SmartRouter freezes after the first matched request).
 */
export function buildInternalErrorResponse(c: Context): Response {
  return jsonNoStore(c, { ok: false, reason: 'internal-error', message: 'Unexpected server error.' }, 500);
}

// Each sub-router gets its own notFound override BEFORE mounting. Hono v4
// does NOT fall through from a sub-router's default 404 back to the parent's
// `notFound` handler — without these per-router overrides callers see Hono's
// default `text/plain; 404 Not Found` and the IPC contract leaks. Known-route
// verb mismatches are handled by explicit `.all(...)` route fallbacks inside
// each router so callers get a 405 + Allow header instead of a false 404.
healthRouter.notFound((c) => errorResponse(c, 'not-found', { message: `unknown route: ${c.req.path}` }));
trialsRouter.notFound((c) => errorResponse(c, 'not-found', { message: `unknown route: ${c.req.path}` }));
licensesRouter.notFound((c) => errorResponse(c, 'not-found', { message: `unknown route: ${c.req.path}` }));
webhooksRouter.notFound((c) => errorResponse(c, 'not-found', { message: `unknown route: ${c.req.path}` }));

app.route('/health', healthRouter);
app.route('/trials', trialsRouter);
app.route('/licenses', licensesRouter);
app.route('/webhooks', webhooksRouter);

// Root-level 404 — fires only for paths that match no router prefix
// (e.g. /random/unknown). Sub-router unknowns are handled above.
app.notFound((c) => errorResponse(c, 'not-found', { message: `unknown route: ${c.req.path}` }));

// 500 fallthrough — any unhandled throw inside a handler reaches here
// and we surface a tagged-union `internal-error`. Workers observability
// captures the original `console.error` so the maintainer can debug
// without the response body leaking stack traces.
app.onError((err, c) => {
  console.error('[license-server] unhandled error', err);
  return buildInternalErrorResponse(c);
});

export default app;
