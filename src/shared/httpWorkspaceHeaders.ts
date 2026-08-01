/**
 * HTTP request-header resolution and privacy classification.
 *
 * This dependency-light module owns user-sensitive header matching, Auth-tab
 * injection, and final request-header composition. Runtime transports, capsule
 * export, code generation, and auth previews all consume the same wire shape.
 */

import { isBaselineSensitiveHttpHeader } from './httpSensitiveHeaders';
import type { HttpRequestAuth, HttpRequestV1 } from './httpWorkspaceSchema';

/**
 * Decide whether a header name is sensitive. Matching is case-insensitive and
 * exact; the user allowlist is additive and never weakens the baseline.
 */
export function isHeaderSensitive(
  headerName: string,
  userAllowlist: readonly string[]
): boolean {
  if (typeof headerName !== 'string' || headerName.length === 0) return false;
  const normalizedName = headerName.toLowerCase().trim();
  if (normalizedName.length === 0) return false;
  if (isBaselineSensitiveHttpHeader(normalizedName)) return true;

  for (const allow of userAllowlist) {
    if (typeof allow !== 'string') continue;
    if (allow.toLowerCase().trim() === normalizedName) return true;
  }
  return false;
}

/** UTF-8-safe base64 for Basic auth; `btoa` alone only accepts Latin-1. */
function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/** Default header name when an API-key auth row leaves it blank. */
export const DEFAULT_API_KEY_HEADER = 'X-API-Key';

/** Resolve an Auth-tab configuration into the header it injects. */
export function buildAuthHeader(
  auth: HttpRequestAuth | undefined
): { name: string; value: string } | null {
  if (!auth || auth.kind === 'none') return null;
  if (auth.kind === 'bearer') {
    const token = auth.token ?? '';
    if (token.length === 0) return null;
    return { name: 'Authorization', value: `Bearer ${token}` };
  }
  if (auth.kind === 'basic') {
    const username = auth.username ?? '';
    const password = auth.password ?? '';
    if (username.length === 0 && password.length === 0) return null;
    return {
      name: 'Authorization',
      value: `Basic ${base64Utf8(`${username}:${password}`)}`,
    };
  }

  const headerName = (auth.apiKeyHeader ?? '').trim() || DEFAULT_API_KEY_HEADER;
  const headerValue = auth.apiKeyValue ?? '';
  if (headerValue.length === 0) return null;
  return { name: headerName, value: headerValue };
}

/**
 * Return the injected header name even when its value is incomplete. Capsule
 * serializers use this to redact custom API-key header names unconditionally.
 */
export function authInjectedHeaderName(
  auth: HttpRequestAuth | undefined
): string | null {
  if (!auth || auth.kind === 'none') return null;
  if (auth.kind === 'bearer' || auth.kind === 'basic') return 'Authorization';
  return (auth.apiKeyHeader ?? '').trim() || DEFAULT_API_KEY_HEADER;
}

/**
 * Compose enabled manual rows plus the injected Auth-tab header. Auth wins on
 * a case-insensitive name collision because it is the more specific intent.
 */
export function composeRequestHeaders(
  request: HttpRequestV1
): Array<{ name: string; value: string }> {
  const injected = buildAuthHeader(request.auth);
  const injectedName = injected?.name.toLowerCase() ?? null;
  const headers: Array<{ name: string; value: string }> = [];

  for (const header of request.headers) {
    if (!header.enabled) continue;
    const name = header.name.trim();
    if (name.length === 0) continue;
    if (injectedName !== null && name.toLowerCase() === injectedName) continue;
    headers.push({ name, value: header.value });
  }
  if (injected) headers.push(injected);
  return headers;
}
