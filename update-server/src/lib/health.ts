/**
 * internal — update-server readiness probe.
 *
 * Mirrors `license-server/src/handlers/health.ts` but only probes
 * GitHub (the sole upstream dependency this worker has). Probe results
 * cached for 30s in module-local state so a 30s-poll synthetic
 * monitor doesn't pile up on the GitHub API rate limit.
 */

import type { Env } from '../index';

export const SERVER_NAME = 'lingua-update-server';
export const SERVER_VERSION = '0.1.0';

export type DependencyState = 'ok' | 'degraded' | 'unknown';
export type DependencyName = 'github';

export interface ReadinessSnapshot {
  ok: boolean;
  degraded: DependencyName[];
  dependencies: Record<DependencyName, DependencyState>;
}

const PROBE_TIMEOUT_MS = 1500;
const PROBE_CACHE_TTL_MS = 30_000;

interface CachedProbe {
  state: DependencyState;
  expires: number;
}

let githubCache: CachedProbe | null = null;

export function resetReadinessProbeCacheForTests(): void {
  githubCache = null;
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

async function probeGithub(): Promise<DependencyState> {
  try {
    const result = await probeWithTimeout(
      async () =>
        fetch('https://api.github.com/zen', {
          method: 'GET',
          // GitHub returns 200 for `/zen` even unauthenticated — it's
          // a reachability probe, not a rate-limited API call.
          redirect: 'manual',
          headers: { 'User-Agent': 'lingua-update-server/health' },
        }),
      PROBE_TIMEOUT_MS,
    );
    if (result === 'timeout') return 'degraded';
    return result.status >= 500 ? 'degraded' : 'ok';
  } catch {
    return 'degraded';
  }
}

export async function evaluateReadiness(_env: Env): Promise<ReadinessSnapshot> {
  if (githubCache && githubCache.expires > Date.now()) {
    const dependencies: Record<DependencyName, DependencyState> = {
      github: githubCache.state,
    };
    const degraded = (Object.entries(dependencies) as [DependencyName, DependencyState][])
      .filter(([, state]) => state === 'degraded')
      .map(([name]) => name);
    return {
      ok: degraded.length === 0,
      degraded,
      dependencies,
    };
  }

  const githubState = await probeGithub();
  githubCache = { state: githubState, expires: Date.now() + PROBE_CACHE_TTL_MS };
  const dependencies: Record<DependencyName, DependencyState> = { github: githubState };
  const degraded: DependencyName[] = githubState === 'degraded' ? ['github'] : [];
  return {
    ok: degraded.length === 0,
    degraded,
    dependencies,
  };
}
