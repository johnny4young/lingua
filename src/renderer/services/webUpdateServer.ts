/**
 * Renderer-side wrapper for `GET /web/version` on the
 * `updates.linguacode.dev` worker. implementation
 *
 * The endpoint returns either:
 *   - 200 `{ version: "0.2.1" }` when a release exists.
 *   - 204 (no body) when the GitHub repo has no published release
 *     yet — we map this to `null`.
 *   - Any network / parse / 5xx failure → `null` (silent — telemetry
 *     of update polling has no business signal worth recording).
 *
 * Used only in the web build. Desktop renderers short-circuit
 * upstream via `useWebVersionPolling`.
 */

const REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_BASE_URL = 'https://updates.linguacode.dev';

function getBaseUrl(): string {
  const raw = import.meta.env.VITE_LINGUA_UPDATE_SERVER_URL;
  if (typeof raw !== 'string') return DEFAULT_BASE_URL;
  const trimmed = raw.trim().replace(/\/$/, '');
  return trimmed.length === 0 ? DEFAULT_BASE_URL : trimmed;
}

export interface WebVersionResponse {
  version: string;
}

/**
 * Fetch the latest published version from the update-server.
 * Returns `null` on any non-200 outcome — caller never has to
 * deal with errors, just "did we get a version or not".
 */
export async function fetchLatestWebVersion(): Promise<WebVersionResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${getBaseUrl()}/web/version`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (response.status !== 200) return null;
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.version !== 'string' || body.version.length === 0) {
      return null;
    }
    return { version: body.version };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
