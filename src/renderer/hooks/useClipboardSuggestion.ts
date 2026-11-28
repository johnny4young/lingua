import { useEffect, useState } from 'react';
import { classifyClipboard, type UtilitySuggestionId } from '../clipboard/pasteHandlers';
import { useSettingsStore } from '../stores/settingsStore';
import { readFromClipboard } from '../utils/clipboard';
import { clipboardAutomationAllowed, clipboardReadAllowed } from './clipboardAccess';
import { useEffectiveTier } from './useEntitlement';
import { countChars } from '../components/DeveloperUtilities/toolAnswers';

export interface ClipboardPeek {
  kind: UtilitySuggestionId;
  /** Held in component state only, for the tool previews; never stored, logged or sent. */
  text: string;
  /** Code points, counted once for the list header. */
  chars: number;
}

/**
 * The clipboard while the Utilities tab is active, read when it becomes active
 * and on each window focus. It needs Pro, the Settings opt-in and a browser
 * that can report the permission. Only a value of a known kind is kept, and it
 * is dropped as soon as the tab deactivates.
 */
export function useClipboardSuggestion(active: boolean): ClipboardPeek | null {
  const consent = useSettingsStore((state) => state.utilitiesClipboardOnFocusConsent);
  const tier = useEffectiveTier();
  const allowed = active && clipboardAutomationAllowed(tier, consent);
  const [peek, setPeek] = useState<ClipboardPeek | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let latest = 0;
    const read = async (mayPrompt: boolean) => {
      const run = ++latest;
      let next: ClipboardPeek | null = null;
      try {
        const text = (await clipboardReadAllowed(mayPrompt)) && run === latest ? await readFromClipboard() : null;
        const kind = text === null ? null : classifyClipboard(text);
        next = kind && text !== null ? { kind, text, chars: countChars(text) } : null;
      } catch {
        // A value no detector can read is no suggestion.
      }
      if (run !== latest) return;
      setPeek((current) => (current?.text === next?.text && current?.kind === next?.kind ? current : next));
    };
    const onFocus = () => void read(false);
    void read(true);
    window.addEventListener('focus', onFocus);
    return () => {
      latest = -1;
      setPeek(null);
      window.removeEventListener('focus', onFocus);
    };
  }, [allowed]);

  return allowed ? peek : null;
}
