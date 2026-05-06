/**
 * Lingua license-server (RL-061 Slice 2).
 *
 * Cloudflare Worker hosted at `licenses.linguacode.dev`. Sibling of the
 * `update-server/` worker (which proxies GitHub Releases for Squirrel).
 * Source-of-truth for license issuance, device tracking, trial minting,
 * and renewal token refresh — see docs/LICENSING_ADR.md Decision 2.
 *
 * Slice 1 shipped the router skeleton + D1 schema + 501 stubs.
 * Slice 2 promotes /webhooks/polar + /licenses/{activate,status,
 * devices/remove} to real D1-backed implementations, with split-bucket
 * device limit (3 desktop + 3 web) per the 2026-04-26 design lock.
 * Slice 3 ships the device-management UI in the Electron renderer;
 * Slice 4 wires trial + education + recovery; Slice 5 ships the
 * release pipeline + web update banner.
 *
 * Every route returns the same tagged-union shape:
 *   { ok: true,  ...payload }
 *   { ok: false, reason, message?, issues? }
 *
 * matching the `licenseStore` IPC bridge contract from RL-059 Slice 0.
 */

import { Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { errorResponse } from './lib/errors';
import { healthRouter } from './handlers/health';
import { educationRouter } from './handlers/education';
import { licensesRouter } from './handlers/licenses';
import { recoverRouter } from './handlers/recover';
import { trialsRouter } from './handlers/trials';
import { webhooksRouter } from './handlers/webhooks';
import { jsonNoStore } from './lib/json';
import { classifyError, log, requestObservabilityMiddleware } from './lib/observability';

export interface Env {
  /**
   * D1 binding declared in wrangler.toml. Slice 2 wires `licenses` +
   * `devices` reads/writes; `trials` + `educations` come in Slice 4.
   */
  DB: D1Database;
  /**
   * Workers KV binding for rate-limit buckets. Declared in
   * wrangler.toml; Slice 4 consumes it from /trials/start and
   * /licenses/recover. Slice 2 leaves it unused but the binding is
   * declared so Slice 4 doesn't need a wrangler.toml change.
   */
  RATE_LIMIT: KVNamespace;
  /**
   * Polar webhook secret (HMAC). Set via `wrangler secret put
   * POLAR_WEBHOOK_SECRET`.
   */
  POLAR_WEBHOOK_SECRET: string;
  /**
   * Polar API key. Slice 2 declares it but does not call back into
   * Polar — webhook signature + D1 idempotency are sufficient.
   * Reserved for Slice 5 (checkout-link generation).
   */
  POLAR_API_KEY: string;
  /**
   * Ed25519 private key (JWK string). Set via `wrangler secret put
   * LINGUA_LICENSE_PRIVATE_KEY_JWK`.
   */
  LINGUA_LICENSE_PRIVATE_KEY_JWK: string;
  /**
   * Ed25519 public key (JWK string). Pair of the private key. Used
   * by /licenses/* endpoints to verify the token clients submit.
   */
  LINGUA_LICENSE_PUBLIC_KEY_JWK: string;
  /**
   * Resend API key. Set via `wrangler secret put RESEND_API_KEY`.
   * Slice 2 sends the buyer email when a Polar webhook successfully
   * mints a license.
   */
  RESEND_API_KEY: string;
  /** Resend "from" email address. Vars in wrangler.toml. */
  RESEND_FROM_EMAIL: string;
  /** Resend "from" display name. Vars in wrangler.toml. */
  RESEND_FROM_NAME: string;
  /** Comma-separated CORS allowlist. Vars in wrangler.toml. */
  CORS_ALLOWED_ORIGINS: string;
}

export const app = new Hono<{ Bindings: Env }>();

// RL-091 — global observability middleware. Emits a request.received /
// request.completed envelope per request with route name, status, and
// duration. Sensitive fields are redacted by the logger before
// emission. Mounted before any other middleware so the timing window
// covers the full request lifecycle.
app.use('*', requestObservabilityMiddleware());

/**
 * CORS for browser-side activation calls from the web build. The
 * desktop main process bypasses CORS entirely (Node fetch ignores it),
 * but the web build runs in a real browser at `linguacode.dev` and
 * needs the server to acknowledge its origin. The allowed origins are
 * read at request time from the `CORS_ALLOWED_ORIGINS` env var so a
 * preview deploy can extend the list without a code change.
 *
 * The `/webhooks/polar` route deliberately bypasses CORS — webhooks
 * come from Polar's IP range with no Origin header, and applying CORS
 * would just add noise to the headers.
 */
function buildCorsMiddleware(
  env: Env | undefined,
  options: { allowMethods: string[]; allowHeaders: string[] }
) {
  const raw = env?.CORS_ALLOWED_ORIGINS ?? '';
  const allowList = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return cors({
    origin: (origin) => (allowList.includes(origin) ? origin : null),
    allowMethods: options.allowMethods,
    allowHeaders: options.allowHeaders,
    maxAge: 86400,
  });
}

app.use('/licenses/*', (c, next) =>
  buildCorsMiddleware(c.env, {
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })(c, next)
);

app.use('/trials/*', (c, next) =>
  buildCorsMiddleware(c.env, {
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  })(c, next)
);

// Slice 4 — `/education/*` and `/licenses/recover/*` accept browser
// CORS the same way `/licenses/*` does. The /confirm endpoints
// return HTML (no CORS needed for direct email-link clicks) but
// the /start endpoints are POSTed from the renderer.
app.use('/education/*', (c, next) =>
  buildCorsMiddleware(c.env, {
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  })(c, next)
);

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
educationRouter.notFound((c) => errorResponse(c, 'not-found', { message: `unknown route: ${c.req.path}` }));
recoverRouter.notFound((c) => errorResponse(c, 'not-found', { message: `unknown route: ${c.req.path}` }));
webhooksRouter.notFound((c) => errorResponse(c, 'not-found', { message: `unknown route: ${c.req.path}` }));

app.route('/health', healthRouter);
app.route('/trials', trialsRouter);
app.route('/education', educationRouter);
app.route('/licenses/recover', recoverRouter);
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
  // RL-091 — structured-log the unhandled error with classification so
  // alerts can route by errorClass. The legacy `console.error` line
  // stays as a human-readable fallback for `wrangler tail` sessions
  // until the operator's dashboard is wired up.
  console.error('[license-server] unhandled error', err);
  log('request.unhandled_error', {
    path: c.req.path,
    method: c.req.method,
    errorClass: classifyError(err),
    errorMessage: err instanceof Error ? err.message : String(err),
  });
  return buildInternalErrorResponse(c);
});

export default app;
