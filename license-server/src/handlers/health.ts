/**
 * GET /health — liveness check.
 * GET /health/ready — readiness check (RL-091).
 *
 * Liveness ("am I up?") MUST succeed even if D1 / Polar / Resend are
 * down so the maintainer can distinguish "worker is up but D1 is
 * broken" from "worker is down". Returns a minimal payload that the
 * uptime monitor / smoke tests pin against.
 *
 * Readiness ("am I usable?") probes each external dependency the
 * worker needs and reports degraded ones in a `degraded[]` array. The
 * dashboard / synthetic monitor uses this signal to decide whether
 * to silence alerts during a partial outage. Probe results are cached
 * for 30s in module-local storage so a 30s-poll synthetic monitor
 * doesn't pile up on Polar / Resend.
 */

import { Hono } from 'hono';
import { jsonNoStore } from '../lib/json';
import { methodNotAllowedResponse } from '../lib/errors';
import { log } from '../lib/observability';
import type { Env } from '../index';

export const SERVER_NAME = 'lingua-license-server';
export const SERVER_VERSION = '0.1.0';

export type DependencyState = 'ok' | 'degraded' | 'unknown';
export type DependencyName = 'd1' | 'kv' | 'polar' | 'resend';

export interface ReadinessSnapshot {
  ok: boolean;
  degraded: DependencyName[];
  dependencies: Record<DependencyName, DependencyState>;
}

const PROBE_TIMEOUT_MS = 1000;
const PROBE_CACHE_TTL_MS = 30_000;

interface CachedProbe {
  state: DependencyState;
  expires: number;
}

interface ProbeCache {
  d1: CachedProbe | null;
  kv: CachedProbe | null;
  polar: CachedProbe | null;
  resend: CachedProbe | null;
}

/**
 * Module-local probe cache. Cloudflare Workers persist module state
 * across requests within the same isolate, so a 30s TTL means at most
 * 2 probes/min per isolate per dependency — orders of magnitude below
 * Polar's / Resend's rate limits.
 */
const probeCache: ProbeCache = {
  d1: null,
  kv: null,
  polar: null,
  resend: null,
};

/**
 * Reset the probe cache. Test-only — exported so the readiness suite
 * can run probes without 30s waits between cases.
 */
export function _resetReadinessProbeCache(): void {
  probeCache.d1 = null;
  probeCache.kv = null;
  probeCache.polar = null;
  probeCache.resend = null;
}

async function probeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T | 'timeout'> {
  return Promise.race<Promise<T | 'timeout'>>([
    fn(),
    new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), timeoutMs),
    ),
  ]);
}

async function readCached(
  name: DependencyName,
  probe: () => Promise<DependencyState>,
): Promise<DependencyState> {
  const cached = probeCache[name];
  if (cached && cached.expires > Date.now()) {
    return cached.state;
  }
  const state = await probe();
  probeCache[name] = {
    state,
    expires: Date.now() + PROBE_CACHE_TTL_MS,
  };
  return state;
}

async function probeD1(env: Env): Promise<DependencyState> {
  if (!env.DB) return 'unknown';
  try {
    const result = await probeWithTimeout(
      async () => env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>(),
      PROBE_TIMEOUT_MS,
    );
    return result === 'timeout' ? 'degraded' : 'ok';
  } catch {
    return 'degraded';
  }
}

async function probeKV(env: Env): Promise<DependencyState> {
  if (!env.RATE_LIMIT) return 'unknown';
  try {
    const result = await probeWithTimeout(
      async () => env.RATE_LIMIT.get('__health_probe__'),
      PROBE_TIMEOUT_MS,
    );
    // `null` (key absent) is the success path — the probe is a
    // round-trip check, not a value read.
    return result === 'timeout' ? 'degraded' : 'ok';
  } catch {
    return 'degraded';
  }
}

async function probeHttp(target: string, timeoutMs: number): Promise<DependencyState> {
  try {
    const result = await probeWithTimeout(
      async () =>
        fetch(target, {
          method: 'HEAD',
          // Cloudflare's fetch supports cf-options; we accept the
          // default. Set redirect manual so a 301/302 from upstream
          // doesn't tip us into a different host.
          redirect: 'manual',
        }),
      timeoutMs,
    );
    if (result === 'timeout') return 'degraded';
    // 5xx → degraded. Any non-5xx (including 4xx, redirects) means
    // the upstream is reachable. We don't depend on the response
    // body or status code semantics — just that the network round-
    // trip completed.
    return result.status >= 500 ? 'degraded' : 'ok';
  } catch {
    return 'degraded';
  }
}

async function probePolar(): Promise<DependencyState> {
  return probeHttp('https://api.polar.sh/healthz', PROBE_TIMEOUT_MS);
}

async function probeResend(): Promise<DependencyState> {
  return probeHttp('https://api.resend.com/', PROBE_TIMEOUT_MS);
}

/**
 * Run all dependency probes and return the readiness snapshot. Each
 * probe result is cached for 30s in module storage. Exported so the
 * test suite can assert the contract directly.
 */
export async function evaluateReadiness(env: Env): Promise<ReadinessSnapshot> {
  const [d1, kv, polar, resend] = await Promise.all([
    readCached('d1', () => probeD1(env)),
    readCached('kv', () => probeKV(env)),
    readCached('polar', () => probePolar()),
    readCached('resend', () => probeResend()),
  ]);
  const dependencies: Record<DependencyName, DependencyState> = { d1, kv, polar, resend };
  const degraded = (Object.entries(dependencies) as [DependencyName, DependencyState][])
    .filter(([, state]) => state === 'degraded')
    .map(([name]) => name);
  // `unknown` (binding missing) does NOT count as degraded — that's a
  // misconfigured deploy, not a runtime outage; surface via the
  // dependencies map instead so the operator can see it.
  return {
    ok: degraded.length === 0,
    degraded,
    dependencies,
  };
}

export const healthRouter = new Hono<{ Bindings: Env }>();

healthRouter.get('/', (c) =>
  jsonNoStore(c, {
    ok: true,
    server: SERVER_NAME,
    version: SERVER_VERSION,
  }),
);

healthRouter.all('/', (c) => methodNotAllowedResponse(c, ['GET']));

healthRouter.get('/ready', async (c) => {
  const snapshot = await evaluateReadiness(c.env);
  // Always 200 — the snapshot itself communicates degraded state.
  // Returning 503 on degraded would prevent uptime monitors from
  // reading the `degraded[]` array, which is the actual signal.
  log('health.ready', {
    ok: snapshot.ok,
    degraded: snapshot.degraded,
  });
  return jsonNoStore(c, {
    ok: snapshot.ok,
    server: SERVER_NAME,
    version: SERVER_VERSION,
    degraded: snapshot.degraded,
    dependencies: snapshot.dependencies,
  });
});

healthRouter.all('/ready', (c) => methodNotAllowedResponse(c, ['GET']));
