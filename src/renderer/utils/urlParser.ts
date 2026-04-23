/**
 * RL-068 — URL Parser utility helper.
 *
 * Pure, offline, renderer-side. Uses the platform `URL` constructor for
 * parsing so behavior matches the browser address bar and the Electron
 * renderer exactly. `searchParams` is normalized into an ordered
 * `{ key, value }[]` that preserves duplicate keys (a stock feature of
 * URLSearchParams) — we lose ordering otherwise when callers want to
 * render a table.
 */

export interface ParsedUrl {
  href: string;
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
  query: readonly ParsedQueryParam[];
}

export interface ParsedQueryParam {
  key: string;
  value: string;
}

export type ParseUrlError = 'empty' | 'invalid';

export type ParseUrlResult = ParsedUrl | { error: ParseUrlError };

/**
 * Parse `input` into its URL components.
 *
 * Semantics:
 * - Empty/whitespace-only input returns `{ error: 'empty' }` so callers can
 *   render the idle "paste a URL to see its parts" copy.
 * - Anything the platform `URL` constructor rejects returns
 *   `{ error: 'invalid' }`. We never throw.
 * - Valid input returns a `ParsedUrl`. Fields are mirrored from the
 *   underlying `URL` instance — `protocol` keeps its trailing colon,
 *   `search` keeps its leading `?`, `hash` keeps its leading `#`. That
 *   matches web platform conventions and makes the panel readouts easy
 *   to copy into HTTP clients.
 * - `query` preserves the order and duplicates of `searchParams`.
 *
 * The function never reads or writes network, disk, or clipboard. Safe
 * for both the Electron renderer and the web build; no Node APIs used.
 */
export function parseUrl(input: string): ParseUrlResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { error: 'empty' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: 'invalid' };
  }

  const query: ParsedQueryParam[] = [];
  parsed.searchParams.forEach((value, key) => {
    query.push({ key, value });
  });

  return {
    href: parsed.href,
    protocol: parsed.protocol,
    username: parsed.username,
    password: parsed.password,
    hostname: parsed.hostname,
    port: parsed.port,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
    origin: parsed.origin,
    query,
  };
}

/** Type guard: narrows `ParseUrlResult` to the happy path. */
export function isParsedUrl(result: ParseUrlResult): result is ParsedUrl {
  return !('error' in result);
}
