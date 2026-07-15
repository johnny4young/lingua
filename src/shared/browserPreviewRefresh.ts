/**
 * RL-119 Slice 1 — closed contract for Browser preview live refresh.
 *
 * `0` is the persisted representation of Off. Keeping the setting numeric
 * lets the auto-run scheduler consume the two live values directly while the
 * closed-enum guards reject hand-edited localStorage drift.
 */
export const BROWSER_PREVIEW_REFRESH_INTERVALS = [0, 300, 1_000] as const;

export type BrowserPreviewRefreshInterval =
  (typeof BROWSER_PREVIEW_REFRESH_INTERVALS)[number];

export const DEFAULT_BROWSER_PREVIEW_REFRESH_INTERVAL: BrowserPreviewRefreshInterval =
  300;

const BROWSER_PREVIEW_REFRESH_INTERVAL_SET: ReadonlySet<number> = new Set(
  BROWSER_PREVIEW_REFRESH_INTERVALS
);

export function isBrowserPreviewRefreshInterval(
  value: unknown
): value is BrowserPreviewRefreshInterval {
  return (
    typeof value === 'number' &&
    BROWSER_PREVIEW_REFRESH_INTERVAL_SET.has(value)
  );
}

export function sanitizeBrowserPreviewRefreshInterval(
  value: unknown
): BrowserPreviewRefreshInterval {
  return isBrowserPreviewRefreshInterval(value)
    ? value
    : DEFAULT_BROWSER_PREVIEW_REFRESH_INTERVAL;
}

/**
 * Read a per-tab override from the first physical line only.
 *
 * The whole line must be the directive (apart from whitespace and an optional
 * UTF-8 BOM), so a string literal or trailing prose cannot accidentally
 * change execution behavior. `null` means no valid override was supplied.
 */
export function extractBrowserPreviewRefreshMagicComment(
  code: string
): BrowserPreviewRefreshInterval | null {
  if (typeof code !== 'string' || code.length === 0) return null;
  const firstLine = code.split(/\r?\n/u, 1)[0] ?? '';
  const match = firstLine.match(
    /^\uFEFF?\s*\/\/\s*@preview-refresh\s+(off|300|1000)\s*$/iu
  );
  const token = match?.[1]?.toLowerCase();
  if (token === 'off') return 0;
  if (token === '300') return 300;
  if (token === '1000') return 1_000;
  return null;
}

export function resolveBrowserPreviewRefreshInterval(
  code: string,
  preference: BrowserPreviewRefreshInterval
): BrowserPreviewRefreshInterval {
  return extractBrowserPreviewRefreshMagicComment(code) ?? preference;
}
