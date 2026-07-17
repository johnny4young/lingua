import { SendHorizontal, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KEYBOARD_SHORTCUTS,
  formatShortcutCombo,
  resolveCombos,
  resolveShortcutDisplayPlatform,
} from '../../data/keyboardShortcuts';
import { useSettingsStore } from '../../stores/settingsStore';
import { EmptyState } from '../ui/EmptyState';
import { Kbd } from '../ui/ModalShell';

/**
 * SR-38 — actionable empty state for the HTTP workspace collection.
 *
 * The collection is a single COLLECTION workspace tab (not one tab per
 * request), so when it holds no requests the panel used to show a
 * title/body with NO next step. This surfaces the two real first moves:
 * a primary "New request" CTA that drops the user straight into the
 * editor, and a discoverable import hint pointing at the global Import
 * overlay (paste a Postman export or a cURL command) with its live,
 * override-aware, platform-glyph keyboard shortcut.
 */
function useImportShortcutCombo(): string | null {
  const shortcutOverrides = useSettingsStore(state => state.shortcutOverrides);
  return useMemo(() => {
    const runtimePlatform =
      typeof window !== 'undefined' ? (window.lingua?.platform ?? 'web') : 'web';
    const navigatorPlatform =
      typeof navigator !== 'undefined' ? navigator.platform : undefined;
    const displayPlatform = resolveShortcutDisplayPlatform(
      runtimePlatform,
      navigatorPlatform
    );
    const definition = KEYBOARD_SHORTCUTS.find(
      entry => entry.id === 'action-open-import-overlay'
    );
    if (!definition) return null;
    const combo = resolveCombos(definition, shortcutOverrides)[0];
    return combo ? formatShortcutCombo(combo, displayPlatform) : null;
  }, [shortcutOverrides]);
}

export function HttpEmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();
  const importCombo = useImportShortcutCombo();

  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-6">
      <EmptyState
        icon={<SendHorizontal size={18} aria-hidden="true" />}
        title={t('httpWorkspace.empty.title')}
        description={t('httpWorkspace.empty.body')}
        action={
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={onCreate}
              data-testid="http-workspace-empty-create"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-body-sm font-semibold text-fg-on-accent transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
            >
              <Plus size={13} aria-hidden="true" />
              {t('httpWorkspace.empty.cta')}
            </button>
            {importCombo ? (
              <p
                data-testid="http-workspace-empty-import-hint"
                className="flex flex-col items-center gap-1.5 text-caption text-fg-subtle"
              >
                <span>{t('httpWorkspace.empty.importPrompt')}</span>
                <span className="flex items-center gap-1.5">
                  <Kbd>{importCombo}</Kbd>
                  {t('httpWorkspace.empty.importAction')}
                </span>
              </p>
            ) : null}
          </div>
        }
      />
    </div>
  );
}
