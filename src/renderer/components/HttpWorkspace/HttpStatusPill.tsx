/**
 * Color-coded HTTP status pill.
 *
 * Converged onto the shared `<StatusBadge>`
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
import type { HttpResponseV1 } from '../../../shared/httpWorkspaceSchema';
import { StatusBadge } from '../ui/StatusBadge';
import { labelForResponse, toneForResponse } from './httpStatus';

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
      className="inline-flex min-w-0 max-w-full"
      title={label}
    >
      <StatusBadge tone={tone} dot shrink>
        <span className="truncate tabular-nums">{label}</span>
      </StatusBadge>
    </span>
  );
}
