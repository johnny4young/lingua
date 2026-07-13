import i18next from 'i18next';
import {
  KEYBOARD_SHORTCUTS,
  formatShortcutCombo,
  resolveCombos,
  resolveShortcutDisplayPlatform,
} from '../data/keyboardShortcuts';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { useUtilityOutputStore } from '../stores/utilityOutputStore';
import { trackEvent } from '../utils/telemetry';
import { takePendingClipboardApply } from './useClipboardOnFocus';

let utilityClipboardInFlight = false;

function getShortcutLabel(shortcutId: string): string | undefined {
  const definition = KEYBOARD_SHORTCUTS.find(entry => entry.id === shortcutId);
  if (!definition) return undefined;
  const combo = resolveCombos(definition, useSettingsStore.getState().shortcutOverrides)[0];
  if (!combo) return undefined;

  const runtimePlatform =
    typeof window !== 'undefined' ? (window.lingua?.platform ?? 'web') : 'web';
  const navigatorPlatform = typeof navigator !== 'undefined' ? navigator.platform : undefined;
  const displayPlatform = resolveShortcutDisplayPlatform(runtimePlatform, navigatorPlatform);
  return formatShortcutCombo(combo, displayPlatform);
}

export function runUtilityApplyFromInput(): void {
  const handler = useUtilityOutputStore.getState().getApplyHandler();
  const pushNotice = useUIStore.getState().pushStatusNotice;
  const pending = takePendingClipboardApply();

  if (pending) {
    try {
      pending.applyClipboardValue(pending.value);
    } catch {
      // Preserve the single-keystroke flow; the pending value was prevalidated.
    }
    void trackEvent('utility.clipboard.applied', { utilityId: pending.utilityId });
    pushNotice({
      tone: 'success',
      messageKey: 'utilities.toast.clipboardApplied',
      values: {
        toolName: i18next.t(`utilities.tool.${camelToolKey(pending.utilityId)}.titleLabel`),
      },
    });
    return;
  }

  if (!handler) {
    pushNotice({ tone: 'info', messageKey: 'utilities.toast.applyUnavailable' });
    return;
  }

  const descriptor = handler();
  if (!descriptor || !descriptor.enabled) {
    pushNotice({ tone: 'info', messageKey: 'utilities.toast.applyUnavailable' });
    return;
  }

  try {
    descriptor.run();
    pushNotice({
      tone: 'success',
      messageKey: 'utilities.toast.applySuccess',
      values: { toolName: i18next.t(descriptor.toolNameKey) },
    });
  } catch {
    pushNotice({ tone: 'error', messageKey: 'utilities.toast.applyUnavailable' });
  }
}

function camelToolKey(id: string): string {
  return id.replace(/-([a-z])/g, (_match, ch: string) => ch.toUpperCase());
}

export async function writeUtilityOutputToClipboard(mode: 'copy' | 'replace'): Promise<void> {
  if (utilityClipboardInFlight) return;
  utilityClipboardInFlight = true;
  try {
    const provider = useUtilityOutputStore.getState().getProvider();
    const pushNotice = useUIStore.getState().pushStatusNotice;

    if (!provider) {
      pushNotice({ tone: 'info', messageKey: 'utilities.toast.copyOutputEmpty' });
      return;
    }

    const value = provider();
    if (value === null || value === '') {
      pushNotice({ tone: 'info', messageKey: 'utilities.toast.copyOutputEmpty' });
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      pushNotice({
        tone: 'success',
        messageKey:
          mode === 'replace'
            ? 'utilities.toast.replaceClipboardSuccess'
            : 'utilities.toast.copyOutputSuccess',
        values: {
          shortcut:
            getShortcutLabel(
              mode === 'replace' ? 'utility-replace-clipboard' : 'utility-copy-output'
            ) ?? '',
        },
      });
    } catch {
      pushNotice({ tone: 'error', messageKey: 'utilities.toast.copyOutputFailed' });
    }
  } finally {
    utilityClipboardInFlight = false;
  }
}
