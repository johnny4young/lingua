/**
 * internal — license-server observability layer.
 *
 * Cloudflare Workers default-pipe `console.log` to Logpush, so a typed
 * structured logger emitting JSON to stdout is the right wire format —
 * no new runtime dependency, no SDK to wire up. The catalog of event
 * names + payload shapes lives below as the contract the operator pins
 * dashboards / alerts / runbooks against.
 *
 * The redactor strips fields that should never appear in operator-
 * visible logs (license tokens, private keys, JWKs, signatures, raw
 * email bodies, Polar webhook payloads). Defense-in-depth — the
 * existing privacy posture (`PRIVACY.md`) already forbids logging
 * those, this turns the policy into a typed function call sites use
 * uniformly.
 *
 * Error classification gives the operator one signal per request:
 *   - client   → bad input, user error, no oncall page
 *   - server   → bug in our code, page oncall on threshold breach
 *   - upstream → Polar / Resend / GitHub / D1 returned 5xx
 *   - storage  → D1 / KV failure (own infra)
 *
 * Pure module, no Hono import beyond the Context type — keeps it
 * unit-testable in isolation.
 */

import type { Context, MiddlewareHandler } from 'hono';

export type ErrorClass = 'client' | 'server' | 'upstream' | 'storage';

/**
 * Canonical structured-log event payload. Every emission goes through
 * `log()` which stamps `event` + `timestamp` and runs the rest of the
 * payload through the redactor.
 */
export interface LogEvent {
  event: string;
  timestamp: string;
  route?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  errorClass?: ErrorClass;
  // Free-form payload survives the redactor; sensitive keys are
  // replaced with the literal string `[redacted]`.
  [key: string]: unknown;
}

/**
 * Sensitive-key denylist. Compared case-insensitively. Any payload
 * field whose key matches is replaced with `[redacted]`. Nested
 * objects are walked up to MAX_REDACT_DEPTH.
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set(
  [
    'token',
    'tokens',
    'authorization',
    'auth',
    'cookie',
    'signature',
    'polarSignature',
    'polar_signature',
    'jwk',
    'publicKeyJwk',
    'privateKey',
    'privateKeyJwk',
    'secret',
    'apiKey',
    'api_key',
    'password',
    'webhookSecret',
    'emailBody',
    'email_body',
    'htmlBody',
    'textBody',
  ].map((key) => key.toLowerCase()),
);

const MAX_REDACT_DEPTH = 4;
const REDACTED_VALUE = '[redacted]';

/**
 * Recursively replace values of sensitive-keyed fields with the literal
 * string `[redacted]`. Walks plain objects and arrays. Bails on cycles
 * via depth cap (4 levels is more than enough for anything we log).
 */
export function redact(payload: unknown, depth = 0): unknown {
  if (depth >= MAX_REDACT_DEPTH) {
    return Array.isArray(payload) ? '[truncated-array]' : '[truncated-object]';
  }

  if (payload === null || payload === undefined) return payload;
  if (typeof payload !== 'object') return payload;

  if (Array.isArray(payload)) {
    return payload.map((item) => redact(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = REDACTED_VALUE;
      continue;
    }
    out[key] = redact(value, depth + 1);
  }
  return out;
}

/**
 * Classify an error so the operator can route alerts. Defaults to
 * `server` — anything we didn't anticipate is a bug in our code until
 * proven otherwise.
 */
export function classifyError(err: unknown): ErrorClass {
  if (err === null || err === undefined) return 'server';

  const name =
    err instanceof Error
      ? err.name
      : typeof err === 'object' && err !== null && 'name' in err
        ? String((err as { name: unknown }).name)
        : '';
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : '';

  // Hono validation / HTTP exceptions → client.
  if (name === 'HTTPException' || name === 'ZodError') return 'client';
  if (
    /\b(invalid|missing|malformed|forbidden)\b/i.test(message) ||
    /\bunauthor\w*/i.test(message) ||
    /\bunauthent\w*/i.test(message)
  ) {
    return 'client';
  }

  // D1 / KV errors → storage. Cloudflare exposes these with `D1_` or
  // `KV_` prefixes on the message in most failure modes.
  if (/\bD1_/.test(message) || /\bKV_/.test(message)) return 'storage';
  if (name === 'D1Error') return 'storage';

  // Fetch / network failures to upstream services → upstream.
  if (name === 'TypeError' && /fetch failed|network/i.test(message)) {
    return 'upstream';
  }
  if (/\b(github|polar|resend)\b.*(5\d\d|timeout|unreachable)/i.test(message)) {
    return 'upstream';
  }

  return 'server';
}

/**
 * Classify handled HTTP responses. Many Worker handlers intentionally
 * return tagged 4xx / 5xx responses instead of throwing, so the request
 * envelope still needs an `errorClass` for dashboards and alert rules.
 */
export function classifyResponseStatus(status: number): ErrorClass | undefined {
  if (status < 400) return undefined;
  if (status < 500) return 'client';
  return 'server';
}

/**
 * Emit a structured log line. Cloudflare's Logpush picks up
 * `console.log` JSON and ships it to the configured destination. We
 * keep the wire format flat (no nested envelope) so dashboards can
 * filter on top-level keys directly.
 */
export function log(event: string, payload: Record<string, unknown> = {}): void {
  const redacted = redact(payload, 0) as Record<string, unknown>;
  const line: LogEvent = {
    event,
    timestamp: new Date().toISOString(),
    ...redacted,
  };
  // Structured logging is the contract; Cloudflare Logpush picks up
  // `console.log` JSON automatically. Worker projects don't lint
  // against `no-console` so no eslint-disable is needed here.
  console.log(JSON.stringify(line));
}

/**
 * Wrap a route handler with request.received / request.completed
 * envelopes. The wrapper is transparent on the happy path (returns
 * the handler's response unchanged) and re-throws on error after
 * emitting a request.completed event with `errorClass`. Hono's
 * `app.onError` still captures the throw and returns the existing
 * tagged-union 500.
 */
export async function withRequestObservability(
  c: Context,
  routeName: string,
  fn: () => Promise<Response>,
): Promise<Response> {
  const started = Date.now();
  log('request.received', {
    route: routeName,
    method: c.req.method,
    path: c.req.path,
  });

  try {
    const response = await fn();
    const errorClass = classifyResponseStatus(response.status);
    log('request.completed', {
      route: routeName,
      method: c.req.method,
      status: response.status,
      durationMs: Date.now() - started,
      errorClass,
    });
    return response;
  } catch (err) {
    const errorClass = classifyError(err);
    log('request.completed', {
      route: routeName,
      method: c.req.method,
      status: 500,
      durationMs: Date.now() - started,
      errorClass,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Map a request path to a stable, low-cardinality route name. Dashboards
 * group by the returned label, so we collapse path parameters and query
 * strings deliberately — `/licenses/status?token=...` becomes
 * `licenses.status`, not 9 distinct labels per token value. Keep in
 * sync with the route surface in `src/index.ts`.
 */
export function routeNameFromPath(path: string): string {
  // Drop trailing slash + query string so collapsing is consistent.
  const cleanPath = path.split('?')[0]?.replace(/\/$/, '') ?? '';
  if (cleanPath === '' || cleanPath === '/health') return 'health.live';
  if (cleanPath === '/health/ready') return 'health.ready';
  if (cleanPath === '/licenses/activate') return 'licenses.activate';
  if (cleanPath === '/licenses/status') return 'licenses.status';
  if (cleanPath === '/licenses/devices/remove') return 'licenses.devices.remove';
  if (cleanPath === '/licenses/recover/start') return 'licenses.recover.start';
  if (cleanPath === '/licenses/recover/confirm') return 'licenses.recover.confirm';
  if (cleanPath === '/trials/start') return 'trials.start';
  if (cleanPath === '/education/start') return 'education.start';
  if (cleanPath === '/education/confirm') return 'education.confirm';
  if (cleanPath === '/education/renew') return 'education.renew';
  if (cleanPath === '/webhooks/polar') return 'webhooks.polar';
  return 'unknown';
}

/**
 * Hono middleware that emits a request.received / request.completed
 * envelope for every request. Mounted globally in `src/index.ts` so
 * route handlers don't need to wrap themselves. Errors re-throw so
 * `app.onError` keeps producing the existing tagged-union 500.
 */
export function requestObservabilityMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const started = Date.now();
    const routeName = routeNameFromPath(c.req.path);
    log('request.received', {
      route: routeName,
      method: c.req.method,
      path: c.req.path,
    });

    try {
      await next();
      const errorClass = classifyResponseStatus(c.res.status);
      log('request.completed', {
        route: routeName,
        method: c.req.method,
        status: c.res.status,
        durationMs: Date.now() - started,
        errorClass,
      });
    } catch (err) {
      const errorClass = classifyError(err);
      log('request.completed', {
        route: routeName,
        method: c.req.method,
        status: 500,
        durationMs: Date.now() - started,
        errorClass,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}
