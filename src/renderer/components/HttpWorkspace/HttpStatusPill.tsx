/**
 * implementation note — Color-coded HTTP status pill.
 *
 * FASE 2b (MOV.05) — converged onto the shared `<StatusBadge>`
 * primitive. The HTTP-range classifier is the specialized logic that
 * survives verbatim; only the chip shell changes. The five response
 * buckets re-map onto StatusBadge tones:
 *
 *   - 2xx → success (emerald family).
 *   - 3xx → info (informational redirect; should be rare because
 *     fetch follows redirects, but server-side debugging surfaces
 *     it occasionally).
 *   - 4xx → warning (client error — bad request, auth, not-found).
 *   - 5xx → error (server error — owner needs to act).
 *   - network/cors/timeout → neutral (no-response failures get the
 *     muted tone so the user reads them as "infrastructure",
 *     distinct from a 4xx/5xx where the server is talking).
 *   - too-large → warning (server responded fine; we capped).
 *
 * The numeric `200 OK` label builder is preserved; `tabular-nums`
 * keeps the status code from shifting width as it ticks.
 */

import { useTranslation } from 'react-i18next';
import type { HttpResponseV1 } from '../../../shared/httpWorkspace';
import { StatusBadge, type StatusBadgeTone } from '../ui/StatusBadge';

function toneForResponse(response: HttpResponseV1): StatusBadgeTone {
  if (
    response.kind === 'network-error' ||
    response.kind === 'cors-error' ||
    response.kind === 'timeout'
  ) {
    return 'neutral';
  }
  if (response.kind === 'too-large') return 'warning';
  if (response.status >= 200 && response.status < 300) return 'success';
  if (response.status >= 300 && response.status < 400) return 'info';
  if (response.status >= 400 && response.status < 500) return 'warning';
  return 'error';
}

function labelForResponse(
  response: HttpResponseV1,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (response.kind === 'network-error') return t('httpWorkspace.response.kind.network');
  if (response.kind === 'cors-error') return t('httpWorkspace.response.kind.cors');
  if (response.kind === 'timeout') return t('httpWorkspace.response.kind.timeout');
  // Standard HTTP status renders as `200 OK`; fallback to just the
  // number when statusText is empty (rare but possible for some
  // proxies).
  const text = response.statusText.length > 0 ? ` ${response.statusText}` : '';
  return `${response.status}${text}`;
}

export interface HttpStatusPillProps {
  response: HttpResponseV1;
}

export function HttpStatusPill({ response }: HttpStatusPillProps) {
  const { t } = useTranslation();
  const tone = toneForResponse(response);
  const label = labelForResponse(response, t);
  return (
    <span
      data-testid="http-status-pill"
      data-tone={tone}
      data-kind={response.kind}
      data-status={response.status}
      className="inline-flex"
    >
      <StatusBadge tone={tone} dot>
        <span className="tabular-nums">{label}</span>
      </StatusBadge>
    </span>
  );
}
