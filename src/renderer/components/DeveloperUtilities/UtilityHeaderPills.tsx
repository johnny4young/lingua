import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KEYBOARD_SHORTCUTS,
  formatShortcutCombo,
  resolveCombos,
  resolveShortcutDisplayPlatform,
} from '../../data/keyboardShortcuts';
import { DEVELOPER_UTILITIES } from '../../data/developerUtilities';
import { Kbd } from '../ui/ModalShell';
import { useSettingsStore } from '../../stores/settingsStore';
import { cn } from '../../utils/cn';

/**
 * The two compact status pills of the Utilities workspace — the
 * copy-output shortcut hint and the live tool counter. Extracted into
 * their own module (out of DeveloperUtilitiesModal.tsx) so the app shell
 * can lazy-load JUST the pills into the editor chips row when a Utilities
 * tab is active, without pulling the whole modal chunk into AppLayout.
 */

const COPY_OUTPUT_SHORTCUT_HINT = {
  id: 'utility-copy-output',
  labelKey: 'utilities.shortcuts.copyOutput',
} as const;

function getShortcutDisplayPlatform() {
  const runtimePlatform =
    typeof window !== 'undefined' ? (window.lingua?.platform ?? 'web') : 'web';
  const navigatorPlatform = typeof navigator !== 'undefined' ? navigator.platform : undefined;
  return resolveShortcutDisplayPlatform(runtimePlatform, navigatorPlatform);
}

function useCopyOutputShortcutHint() {
  const shortcutOverrides = useSettingsStore(state => state.shortcutOverrides);
  return useMemo(() => {
    // The footer/header reflects user shortcut overrides and platform glyphs,
    // so resolve it from the same shortcut catalog used by the key handler.
    const displayPlatform = getShortcutDisplayPlatform();
    const definition = KEYBOARD_SHORTCUTS.find(entry => entry.id === COPY_OUTPUT_SHORTCUT_HINT.id);
    if (!definition) return null;
    const combo = resolveCombos(definition, shortcutOverrides)[0];
    if (!combo) return null;
    return {
      labelKey: COPY_OUTPUT_SHORTCUT_HINT.labelKey,
      combo: formatShortcutCombo(combo, displayPlatform),
    };
  }, [shortcutOverrides]);
}

export function UtilityCopyShortcutHint({ className }: { className?: string }) {
  const { t } = useTranslation();
  const copyOutputShortcutHint = useCopyOutputShortcutHint();

  if (!copyOutputShortcutHint) return <span />;

  return (
    <span
      className={cn('flex items-center gap-[6px] text-caption text-fg-subtle', className)}
      aria-label={t('utilities.shortcuts.outputAriaLabel')}
      data-testid="utilities-sidebar-shortcuts"
    >
      <Kbd>{copyOutputShortcutHint.combo}</Kbd>
      {t(copyOutputShortcutHint.labelKey)}
    </span>
  );
}

export function UtilityHeaderPills() {
  const { t } = useTranslation();
  return (
    <>
      <UtilityCopyShortcutHint className="rounded-full border border-border-subtle bg-bg-panel-alt/70 px-2.5 py-1" />
      <span className="rounded-full border border-border-subtle bg-bg-panel-alt/70 px-2.5 py-1 font-mono text-caption text-fg-subtle">
        {t('utilities.toolCount', { count: DEVELOPER_UTILITIES.length })}
      </span>
    </>
  );
}
