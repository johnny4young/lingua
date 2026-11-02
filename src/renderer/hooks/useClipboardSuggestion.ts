import { useEffect, useState } from 'react';
import { classifyClipboard, type UtilitySuggestionId } from '../clipboard/pasteHandlers';
import { useSettingsStore } from '../stores/settingsStore';
import { readFromClipboard } from '../utils/clipboard';
import { clipboardAutomationAllowed, clipboardReadAllowed } from './clipboardAccess';
import { useEffectiveTier } from './useEntitlement';

/**
 * The kind of value on the clipboard while the Utilities tab is active, read
 * when it becomes active and on each window focus. It needs the Labs flag, Pro, the
 * Settings opt-in and a browser that can report the permission. Only the kind
 * stays; the text is never stored or sent.
 */
export function useClipboardSuggestion(active: boolean): UtilitySuggestionId | null {
  const flag = useSettingsStore((state) => state.featureFlags.clipboardChains === true);
  const consent = useSettingsStore((state) => state.utilitiesClipboardOnFocusConsent);
  const tier = useEffectiveTier();
  const allowed = active && flag && clipboardAutomationAllowed(tier, consent);
  const [kind, setKind] = useState<UtilitySuggestionId | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let latest = 0;
    const read = async (mayPrompt: boolean) => {
      const run = ++latest;
      let next: UtilitySuggestionId | null = null;
      try {
        const text = (await clipboardReadAllowed(mayPrompt)) && run === latest ? await readFromClipboard() : null;
        next = text === null ? null : classifyClipboard(text);
      } catch {
        // A value no detector can read is no suggestion.
      }
      if (run === latest) setKind(next);
    };
    const onFocus = () => void read(false);
    void read(true);
    window.addEventListener('focus', onFocus);
    return () => {
      latest = -1;
      setKind(null);
      window.removeEventListener('focus', onFocus);
    };
  }, [allowed]);

  return allowed ? kind : null;
}
