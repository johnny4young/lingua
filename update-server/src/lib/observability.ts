/**
 * RL-091 — update-server observability layer.
 *
 * Sister module to `license-server/src/lib/observability.ts`. Cloudflare
 * Workers can't easily share TypeScript across project boundaries
 * without a custom build step, so this module is intentionally a copy
 * of the license-server contract — same event taxonomy, same redactor,
 * same error classifier, narrower sensitive-key set (no Polar / Resend
 * paths in this project).
 *
 * Update-server doesn't use Hono — it dispatches by `URL.pathname` in
 * a single fetch handler. The integration shape is therefore a
 * higher-order function `wrapRequestObservability(routeName, fn)`
 * rather than a Hono middleware. Same envelope events.
 */

export type ErrorClass = 'client' | 'server' | 'upstream' | 'storage';

export interface LogEvent {
  event: string;
  timestamp: string;
  route?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  errorClass?: ErrorClass;
  [key: string]: unknown;
}

const SENSITIVE_KEYS: ReadonlySet<string> = new Set(
  [
    'token',
    'tokens',
    'authorization',
    'auth',
    'cookie',
    'signature',
    'apiKey',
    'api_key',
    'password',
    'githubToken',
    'github_token',
  ].map((key) => key.toLowerCase()),
);

const MAX_REDACT_DEPTH = 4;
const REDACTED_VALUE = '[redacted]';

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

  if (
    /\b(invalid|missing|malformed|forbidden)\b/i.test(message) ||
    /\bunauthor\w*/i.test(message) ||
    /\bunauthent\w*/i.test(message)
  ) {
    return 'client';
  }

  if (name === 'TypeError' && /fetch failed|network/i.test(message)) {
    return 'upstream';
  }
  if (/\bgithub\b.*(5\d\d|timeout|unreachable)/i.test(message)) {
    return 'upstream';
  }

  return 'server';
}

/**
 * Classify handled HTTP responses. The update feed uses returned 502
 * responses for GitHub failures, so status-based classification keeps
 * those upstream outages visible in the normal request envelope.
 */
export function classifyResponseStatus(
  status: number,
  routeName: string,
): ErrorClass | undefined {
  if (status < 400) return undefined;
  if (status < 500) return 'client';
  if (
    status === 502 &&
    (routeName === 'update.feed' ||
      routeName === 'update.asset_proxy' ||
      routeName === 'update.web_version')
  ) {
    return 'upstream';
  }
  return 'server';
}

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
 * Map a request path to a stable, low-cardinality route name. Path
 * parameters (platform, version, asset id) are collapsed so dashboards
 * group cleanly. Keep in sync with the dispatch in `src/index.ts`.
 *
 * Method-agnostic: the dispatch layer enforces method correctness via
 * 405s, so the route label only depends on the path shape. Keeps the
 * dashboard label space bounded.
 */
export function routeNameFromPath(path: string): string {
  if (path === '/' || path === '/health') return 'health.live';
  if (path === '/health/ready') return 'health.ready';
  if (path === '/web/version') return 'update.web_version';
  if (/^\/update\/(darwin|win32)\/.+$/.test(path)) return 'update.feed';
  if (/^\/download\/\d+$/.test(path)) return 'update.asset_proxy';
  return 'unknown';
}

/**
 * Higher-order helper: wrap a handler in the request envelope. The
 * caller passes the request method + path so the wrapper can record
 * them; the handler's response is returned unchanged on the happy
 * path. Errors re-throw after the completed event so the dispatch in
 * `src/index.ts` keeps surfacing the original failure.
 */
export async function wrapRequestObservability(
  request: Request,
  fn: () => Promise<Response>,
): Promise<Response> {
  const url = new URL(request.url);
  const routeName = routeNameFromPath(url.pathname);
  const started = Date.now();
  log('request.received', {
    route: routeName,
    method: request.method,
    path: url.pathname,
  });

  try {
    const response = await fn();
    const errorClass = classifyResponseStatus(response.status, routeName);
    log('request.completed', {
      route: routeName,
      method: request.method,
      status: response.status,
      durationMs: Date.now() - started,
      errorClass,
    });
    return response;
  } catch (err) {
    const errorClass = classifyError(err);
    log('request.completed', {
      route: routeName,
      method: request.method,
      status: 500,
      durationMs: Date.now() - started,
      errorClass,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
