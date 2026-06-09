import { useEffect, useRef } from 'react';
import i18next from 'i18next';
import {
  KEYBOARD_SHORTCUTS,
  formatShortcutCombo,
  resolveCombos,
  resolveShortcutDisplayPlatform,
} from '../data/keyboardShortcuts';
import { findDeveloperUtility, type DeveloperUtilityId } from '../data/developerUtilities';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { readFromClipboard } from '../utils/clipboard';
import { currentEffectiveTier } from './useEntitlement';
import { isEntitled } from '../../shared/entitlements';

/**
 * RL-069 Slice 3 — clipboard-on-focus apply.
 *
 * When the user has granted consent
 * (`utilitiesClipboardOnFocusConsent === 'granted'`), this hook reads
 * the clipboard ONCE per focus event for the active utility panel
 * (`utilityId`) and surfaces a non-blocking status notice telling them
 * the clipboard is ready and which keystroke applies it. There is no
 * background polling, no retry loop, no cache — every focus reads
 * fresh.
 *
 * Privacy contract:
 *   1. Default off (`'unset'` consent). Without a deliberate user
 *      opt-in via Settings → Editor → Developer Utilities, the
 *      clipboard is never read.
 *   1b. The automation layer requires DEV_UTILITIES, so a Free or
 *       downgraded session cannot read the clipboard even if localStorage
 *       contains a stale granted consent flag.
 *   2. The clipboard contents never leave the renderer. The only
 *      observable effect is a status notice with the resolved
 *      Mod+Shift+A combo for the active platform.
 *   3. A `'declined'` consent is sticky — the hook short-circuits
 *      identically to `'unset'`. The toggle has to be flipped back to
 *      `'granted'` in Settings to re-arm the feature.
 */
export function useClipboardOnFocus(
  utilityId: DeveloperUtilityId,
  /**
   * Caller-supplied predicate that decides whether the clipboard
   * contents are a meaningful match for the focused panel. Usually
   * the catalog's `detect` predicate, but the panel may pass a
   * narrower check (e.g. only fire when the input field is empty).
   */
  detect: (input: string) => boolean,
  /** Imperative apply — called when the user accepts the offer. */
  applyClipboardValue: (value: string) => void,
  options: { enabled?: boolean } = {}
): void {
  const hasFiredForFocusRef = useRef(false);
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    if (!isEntitled(currentEffectiveTier(), 'DEV_UTILITIES')) return;
    const consent = useSettingsStore.getState().utilitiesClipboardOnFocusConsent;
    if (consent !== 'granted') return;
    if (hasFiredForFocusRef.current) return;

    let cancelled = false;
    hasFiredForFocusRef.current = true;

    void (async () => {
      const value = await readFromClipboard();
      if (cancelled || value === null || value.length === 0) return;
      if (!detect(value)) return;

      const definition = findDeveloperUtility(utilityId);
      const toolName = i18next.t(definition.titleKey);
      const shortcut = resolveApplyShortcut();

      useUIStore.getState().pushStatusNotice({
        tone: 'info',
        messageKey: 'utilities.toast.clipboardDetected',
        values: { toolName, shortcut },
      });

      // Stash the value on a module-level singleton so the global
      // Mod+Shift+A handler can fold it into the next apply. The
      // store-based handoff keeps the hook's surface narrow — no need
      // to thread the clipboard value through every panel.
      pendingClipboardApplyRef.value = {
        utilityId,
        value,
        applyClipboardValue,
      };
    })();

    return () => {
      cancelled = true;
      clearPendingClipboardApply(utilityId, applyClipboardValue);
    };
    // Re-fire whenever the panel id changes — the modal mounts a
    // single panel at a time, so a switch from JSON to Base64 should
    // re-read the clipboard against the new detect.
  }, [enabled, utilityId, detect, applyClipboardValue]);
}

interface PendingClipboardApply {
  utilityId: DeveloperUtilityId;
  value: string;
  applyClipboardValue: (value: string) => void;
}

const pendingClipboardApplyRef: { value: PendingClipboardApply | null } = {
  value: null,
};

function clearPendingClipboardApply(
  utilityId: DeveloperUtilityId,
  applyClipboardValue: (value: string) => void
): void {
  const current = pendingClipboardApplyRef.value;
  if (
    current &&
    current.utilityId === utilityId &&
    current.applyClipboardValue === applyClipboardValue
  ) {
    pendingClipboardApplyRef.value = null;
  }
}

/** Imperative read the global Mod+Shift+A handler consults. */
export function takePendingClipboardApply(): PendingClipboardApply | null {
  const current = pendingClipboardApplyRef.value;
  pendingClipboardApplyRef.value = null;
  return current;
}

function resolveApplyShortcut(): string {
  const definition = KEYBOARD_SHORTCUTS.find(entry => entry.id === 'utility-apply-from-input');
  if (!definition) return '';
  const overrides = useSettingsStore.getState().shortcutOverrides;
  const combo = resolveCombos(definition, overrides)[0];
  if (!combo) return '';
  const runtimePlatform =
    typeof window !== 'undefined' ? (window.lingua?.platform ?? 'web') : 'web';
  const navigatorPlatform = typeof navigator !== 'undefined' ? navigator.platform : undefined;
  const displayPlatform = resolveShortcutDisplayPlatform(runtimePlatform, navigatorPlatform);
  return formatShortcutCombo(combo, displayPlatform);
}
