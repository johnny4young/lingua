import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClipboardPeek } from '../../hooks/useClipboardSuggestion';
import { useNow } from '../../hooks/useNow';
import '../../i18n/toolAnswersCatalog';
import { jwtPreview, readLauncherPreviews, type JwtClaims, type LauncherPreviews } from './launcherPreviews';

const NO_PREVIEWS: LauncherPreviews = {};
/** A JWT's time left reads in minutes; a 30 s clock keeps it current. */
const CLOCK_TICK_MS = 30_000;

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
  // Only the JWT answer reads the clock; the rest are read once per value.
  const now = useNow(current?.claims != null, Date.now, CLOCK_TICK_MS);

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
