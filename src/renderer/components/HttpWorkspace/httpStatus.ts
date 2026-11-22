import type { TFunction } from 'i18next';
import type { HttpResponseV1 } from '../../../shared/httpWorkspaceSchema';
import type { StatusBadgeTone } from '../ui/StatusBadge';

/** The request never got a status line back: no network, CORS, or a timeout. */
export function isTransportFailure(response: HttpResponseV1): boolean {
  return response.kind === 'network-error' || response.kind === 'cors-error' || response.kind === 'timeout';
}

export function toneForResponse(response: HttpResponseV1): StatusBadgeTone {
  if (isTransportFailure(response)) return 'neutral';
  if (response.kind === 'too-large') return 'warning';
  if (response.status >= 200 && response.status < 300) return 'success';
  if (response.status >= 300 && response.status < 400) return 'info';
  if (response.status >= 400 && response.status < 500) return 'warning';
  return 'error';
}

/** The `httpWorkspace.response.kind.*` word for a failure with no status line, or undefined. */
export function transportFailureWord(kind: string | undefined): 'network' | 'cors' | 'timeout' | undefined {
  if (kind === 'network-error') return 'network';
  if (kind === 'cors-error') return 'cors';
  return kind === 'timeout' ? 'timeout' : undefined;
}

export function labelForResponse(
  response: HttpResponseV1,
  t: TFunction
): string {
  const word = transportFailureWord(response.kind);
  if (word) return t(`httpWorkspace.response.kind.${word}`);
  // Standard HTTP status renders as `200 OK`; fallback to just the
  // number when statusText is empty (rare but possible for some
  // proxies).
  const text = response.statusText.length > 0 ? ` ${response.statusText}` : '';
  return `${response.status}${text}`;
}

/** A body that survives as text, so saving the decoded string keeps its bytes. */
export function isTextContentType(contentType: string): boolean {
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return /^text\//.test(mime) || /(json|xml|javascript|yaml|csv|x-www-form-urlencoded|graphql)$/.test(mime);
}

/** `application/vnd.api+json; charset=utf-8` → `json`. */
export function shortContentType(contentType: string): string {
  const subtype = contentType.split(';')[0]?.split('/')[1]?.trim().toLowerCase() ?? '';
  return subtype.split('+').at(-1) ?? '';
}
