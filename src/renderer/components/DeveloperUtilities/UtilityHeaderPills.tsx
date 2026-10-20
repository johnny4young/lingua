import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatShortcutLabel } from '../../data/keyboardShortcuts';
import { Kbd } from '../ui/ModalShell';
import { useSettingsStore } from '../../stores/settingsStore';
import { cn } from '../../utils/cn';

/**
 * The compact status pill of the Utilities workspace — the copy-output
 * shortcut hint. It lives in its own module (out of
 * DeveloperUtilitiesModal.tsx) so the app shell can lazy-load JUST the
 * pill into the editor tab strip when a Utilities
 * tab is active, without pulling the whole modal chunk into AppLayout.
 */

const COPY_OUTPUT_SHORTCUT_HINT = {
  id: 'utility-copy-output',
  labelKey: 'utilities.shortcuts.copyOutput',
} as const;

function useCopyOutputShortcutHint() {
  const shortcutOverrides = useSettingsStore(state => state.shortcutOverrides);
  return useMemo(() => {
    // The footer/header reflects user shortcut overrides and platform glyphs,
    // so resolve it from the same shortcut catalog used by the key handler.
    const combo = formatShortcutLabel(COPY_OUTPUT_SHORTCUT_HINT.id, shortcutOverrides);
    if (!combo) return null;
    return { labelKey: COPY_OUTPUT_SHORTCUT_HINT.labelKey, combo };
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
  // The tool count lives in the tool list footer.
  return (
    <UtilityCopyShortcutHint className="rounded-full border border-border-subtle bg-bg-panel-alt/70 px-2.5 py-1" />
  );
}
