/**
 * RL-097 Slice 1 fold C — Color-coded HTTP status pill.
 *
 * Mirrors the visual language of `<GitStatusPill>` (RL-102 Slice 1)
 * and `<RunStatusPill>` (RL-020 Slice 7):
 *
 *   - 2xx → emerald (success).
 *   - 3xx → blue (informational redirect; should be rare because
 *     fetch follows redirects, but server-side debugging surfaces
 *     it occasionally).
 *   - 4xx → amber (client error — bad request, auth, not-found).
 *   - 5xx → rose (server error — owner needs to act).
 *   - network/cors/timeout → slate (no-response failures get the
 *     muted tone so the user reads them as "infrastructure",
 *     distinct from a 4xx/5xx where the server is talking).
 *   - too-large → amber (server responded fine; we capped).
 *
 * The pill renders compact (10 px text, 6 px padding) so it fits in
 * the response preview header without competing with the body for
 * vertical space.
 */

import { useTranslation } from 'react-i18next';
import type { HttpResponseV1 } from '../../../shared/httpWorkspace';

type PillTone = 'emerald' | 'blue' | 'amber' | 'rose' | 'slate';

const TONE_CLASS: Record<PillTone, string> = {
  emerald:
    'text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 ring-1 ring-emerald-500/30',
  blue: 'text-sky-700 dark:text-sky-300 bg-sky-500/15 ring-1 ring-sky-500/30',
  amber:
    'text-amber-700 dark:text-amber-300 bg-amber-500/15 ring-1 ring-amber-500/30',
  rose: 'text-rose-700 dark:text-rose-300 bg-rose-500/15 ring-1 ring-rose-500/30',
  slate:
    'text-muted bg-surface-strong/40 ring-1 ring-border/40',
};

function toneForResponse(response: HttpResponseV1): PillTone {
  if (
    response.kind === 'network-error' ||
    response.kind === 'cors-error' ||
    response.kind === 'timeout'
  ) {
    return 'slate';
  }
  if (response.kind === 'too-large') return 'amber';
  if (response.status >= 200 && response.status < 300) return 'emerald';
  if (response.status >= 300 && response.status < 400) return 'blue';
  if (response.status >= 400 && response.status < 500) return 'amber';
  return 'rose';
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
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium leading-[14px] tabular-nums ${TONE_CLASS[tone]}`}
    >
      {label}
    </span>
  );
}
