/**
 * implementation — `url-parse` adapter.
 *
 * Decodes a URL into its structured components (protocol, host,
 * port, pathname, search params, hash). Output is a JSON-stringified
 * object so it composes downstream with `json-format` — a common
 * recipe is `url-parse → json-format` for pretty-printed URL
 * breakdowns.
 */

import type { UtilityAdapter } from './types';

/** No options implementation. implementation could add `outputShape: 'flat' | 'tree'`. */
export type UrlParseOptions = Record<string, never>;

interface ParsedUrl {
  href: string;
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  username: string;
  password: string;
  origin: string;
  searchParams: Record<string, string | string[]>;
}

function parseUrl(input: string): ParsedUrl | null {
  try {
    const url = new URL(input);
    const searchParams: Record<string, string | string[]> = {};
    for (const [key, value] of url.searchParams.entries()) {
      const existing = searchParams[key];
      if (existing === undefined) {
        searchParams[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        searchParams[key] = [existing, value];
      }
    }
    return {
      href: url.href,
      protocol: url.protocol,
      host: url.host,
      hostname: url.hostname,
      port: url.port,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      username: url.username,
      password: url.password,
      origin: url.origin,
      searchParams,
    };
  } catch {
    return null;
  }
}

export const urlParseAdapter: UtilityAdapter<UrlParseOptions> = {
  id: 'url-parse',
  titleKey: 'utilityPipeline.adapter.urlParse.title',
  descriptionKey: 'utilityPipeline.adapter.urlParse.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [],
  defaultOptions: () => ({}),
  parseOptions: (raw): UrlParseOptions | null => {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) return null;
    return {};
  },
  run: async (input) => {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return { ok: true, value: '' };
    }
    const parsed = parseUrl(trimmed);
    if (parsed === null) {
      return {
        ok: false,
        reason: 'invalid-input',
        detail: 'Not a valid absolute URL',
      };
    }
    try {
      return { ok: true, value: JSON.stringify(parsed, null, 2) };
    } catch (err) {
      return {
        ok: false,
        reason: 'execution-error',
        detail: err instanceof Error ? err.message : 'stringify failed',
      };
    }
  },
};
