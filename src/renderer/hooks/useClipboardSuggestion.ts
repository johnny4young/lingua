import { useEffect, useState } from 'react';
import { classifyClipboard, type UtilitySuggestionId } from '../clipboard/pasteHandlers';
import { useSettingsStore } from '../stores/settingsStore';
import { readFromClipboard } from '../utils/clipboard';
import { useEntitlement } from './useEntitlement';

/**
 * The kind of value on the clipboard while Utilities is on screen, read once
 * when it opens and on each window focus. It needs the Labs flag, Pro and the
 * Settings opt-in. Only the kind stays; the text is never stored or sent.
 */
export function useClipboardSuggestion(active: boolean): UtilitySuggestionId | null {
  const flag = useSettingsStore((state) => state.featureFlags.clipboardChains === true);
  const consent = useSettingsStore((state) => state.utilitiesClipboardOnFocusConsent === 'granted');
  const entitled = useEntitlement('DEV_UTILITIES');
  const allowed = active && flag && consent && entitled;
  const [kind, setKind] = useState<UtilitySuggestionId | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let latest = 0;
    const read = async () => {
      const run = ++latest;
      const text = await readFromClipboard();
      if (run === latest) setKind(text === null ? null : classifyClipboard(text));
    };
    void read();
    window.addEventListener('focus', read);
    return () => {
      latest = -1;
      setKind(null);
      window.removeEventListener('focus', read);
    };
  }, [allowed]);

  return allowed ? kind : null;
}
