/**
 * KV-backed per-key rate limiter (RL-061 Slice 4).
 *
 * Counts hits against a daily-rolling key in the `RATE_LIMIT`
 * Workers KV namespace. Used by:
 *   - /trials/start         (per-IP, 3/day)
 *   - /education/start      (per-IP, 3/day)
 *   - /licenses/recover/start (per-IP, 3/day; per-email check
 *                             also fires upstream)
 *
 * Key shape: `<scope>:rl:<keypart>:<yyyy-mm-dd>` (UTC). The
 * date suffix gives the daily reset for free — no cron, no
 * cleanup. KV automatically expires entries 48h after creation
 * so old keys cost nothing.
 *
 * Caveats documented in BACKLOG.md (security entry, 2026-04-29):
 * KV is eventually consistent across CF PoPs (~60s window). An
 * attacker hitting four PoPs simultaneously can pass 4 hits
 * before the counter syncs. Acceptable for Phase 1 abuse model;
 * Phase 2 magic-link verification mitigates the underlying vector.
 */

const KV_TTL_SECONDS = 48 * 60 * 60; // 48h — covers daily reset boundary

export interface RateLimitInput {
  /** Endpoint scope, e.g. `trials`, `education`, `recovery`. */
  scope: string;
  /** Key part — usually the client IP, optionally suffixed with email for double-keying. */
  keyPart: string;
  /** Maximum hits per UTC day. */
  limit: number;
  /** UTC `now()` in epoch seconds. Tests inject a deterministic clock. */
  now?: () => number;
}

export interface RateLimitAllowed {
  allowed: true;
  /** Number of hits already recorded BEFORE this one. After this call, count is `prior + 1`. */
  prior: number;
  /** Same as `prior + 1`, exposed for callers that want to log "5 of 3" diagnostics. */
  current: number;
}

export interface RateLimitDenied {
  allowed: false;
  /** Hits already recorded. Caller should NOT increment this number — denial is final for the day. */
  current: number;
  /** Seconds until the next UTC midnight. */
  retryAfter: number;
}

export type RateLimitResult = RateLimitAllowed | RateLimitDenied;

/**
 * Build the KV key. Exported so tests can assert the shape.
 */
export function rateLimitKey(scope: string, keyPart: string, dayUtc: string): string {
  return `${scope}:rl:${keyPart}:${dayUtc}`;
}

/**
 * Format an epoch seconds timestamp as a UTC `yyyy-mm-dd` string.
 * Stays compact (10 chars) and sortable. Daily-resetting buckets
 * fall out of this format for free.
 */
export function dayUtc(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Seconds remaining until the next UTC midnight.
 */
function secondsUntilNextUtcMidnight(epochSeconds: number): number {
  const date = new Date(epochSeconds * 1000);
  const next = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );
  return Math.max(0, Math.floor(next / 1000) - epochSeconds);
}

/**
 * Read-then-write counter against `RATE_LIMIT`. Not atomic — KV
 * has no compare-and-swap. Two concurrent requests from the same
 * IP hitting different PoPs can both read 2, both write 3, ending
 * with a logical count of 4 when limit was 3. See the BACKLOG
 * entry for the consistency note. The Phase 1 design accepts this
 * trade-off; Phase 2 either moves to Durable Objects or relies on
 * magic-link verification for the strong abuse mitigation.
 */
export async function consumeRateLimit(
  kv: KVNamespace,
  input: RateLimitInput
): Promise<RateLimitResult> {
  const nowFn = input.now ?? (() => Math.floor(Date.now() / 1000));
  const now = nowFn();
  const key = rateLimitKey(input.scope, input.keyPart, dayUtc(now));

  const raw = await kv.get(key);
  const prior = raw ? Number.parseInt(raw, 10) : 0;
  const safePrior = Number.isFinite(prior) && prior >= 0 ? prior : 0;

  if (safePrior >= input.limit) {
    return {
      allowed: false,
      current: safePrior,
      retryAfter: secondsUntilNextUtcMidnight(now),
    };
  }

  const next = safePrior + 1;
  await kv.put(key, String(next), { expirationTtl: KV_TTL_SECONDS });

  return { allowed: true, prior: safePrior, current: next };
}

/**
 * Read-only check for diagnostics — does NOT increment. Useful in
 * tests and for surfaces that want to display "you have N of M
 * remaining today" without actually consuming a hit.
 */
export async function peekRateLimit(
  kv: KVNamespace,
  input: Omit<RateLimitInput, 'limit'>
): Promise<{ count: number }> {
  const nowFn = input.now ?? (() => Math.floor(Date.now() / 1000));
  const now = nowFn();
  const key = rateLimitKey(input.scope, input.keyPart, dayUtc(now));
  const raw = await kv.get(key);
  const prior = raw ? Number.parseInt(raw, 10) : 0;
  return { count: Number.isFinite(prior) && prior >= 0 ? prior : 0 };
}
