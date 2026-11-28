import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClipboardPeek } from '../../hooks/useClipboardSuggestion';
import '../../i18n/toolAnswersCatalog';
import { claimTime } from './toolAnswers';
import { useToolClock } from './useToolClock';
import { jwtPreview, readLauncherPreviews, type JwtClaims, type LauncherPreviews } from './launcherPreviews';

const NO_PREVIEWS: LauncherPreviews = {};

interface Read {
  peek: ClipboardPeek;
  previews: LauncherPreviews;
  claims: JwtClaims | null;
}

/** The clipboard tools' previews for this peek; dropped with the peek, so no text outlives it. */
export function useLauncherPreviews(peek: ClipboardPeek | null): LauncherPreviews {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [read, setRead] = useState<Read | null>(null);
  if (read && read.peek !== peek) setRead(null);
  const current = read && read.peek === peek ? read : null;
  // Only the JWT answer reads the clock, re-read for each token; the rest are read once per value.
  const claims = current?.claims ?? null;
  const now = useToolClock(claims, claims !== null, [claims ? claimTime(claims.payload.exp) : null]);

  useEffect(() => {
    if (!peek) return;
    let live = true;
    void readLauncherPreviews(peek.text, peek.kind, t, locale)
      // A value no preview can read shows none; it never reaches the crash recorder.
      .catch(() => ({ previews: NO_PREVIEWS, claims: null }))
      .then(({ previews, claims }) => {
        if (live) setRead({ peek, previews, claims });
      });
    return () => {
      live = false;
    };
  }, [peek, t, locale]);

  if (!current) return NO_PREVIEWS;
  return current.claims ? { ...current.previews, jwt: jwtPreview(current.claims, now, t, locale) } : current.previews;
}
