import { Keyboard, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KEYBOARD_SHORTCUTS,
  SHORTCUT_GROUPS,
  filterShortcuts,
  formatShortcutCombo,
  resolveShortcutDisplayPlatform,
  type ShortcutDefinition,
  type ShortcutGroupId,
} from '../../data/keyboardShortcuts';
import { IconButton, OverlayBackdrop, OverlayCard } from '../ui/chrome';

function groupShortcuts(shortcuts: readonly ShortcutDefinition[]) {
  const byGroup = new Map<ShortcutGroupId, ShortcutDefinition[]>();
  for (const shortcut of shortcuts) {
    const bucket = byGroup.get(shortcut.group) ?? [];
    bucket.push(shortcut);
    byGroup.set(shortcut.group, bucket);
  }
  return byGroup;
}

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

export function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const platform = resolveShortcutDisplayPlatform(
    window.lingua?.platform ?? 'unknown',
    window.navigator?.platform
  );

  const matching = useMemo(
    () => filterShortcuts(KEYBOARD_SHORTCUTS, query, platform, t),
    [query, platform, t]
  );

  const grouped = useMemo(() => groupShortcuts(matching), [matching]);

  return (
    <OverlayBackdrop onClose={onClose}>
      <OverlayCard
        data-testid="keyboard-shortcuts-modal"
        className="relative flex h-[min(82vh,760px)] w-full max-w-3xl flex-col overflow-hidden"
      >
        <header className="surface-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[1rem] bg-primary-soft text-primary">
              <Keyboard size={18} />
            </div>
            <div>
              <p className="panel-title">{t('shortcuts.panelTitle')}</p>
              <h2 className="text-sm font-semibold text-foreground">{t('shortcuts.title')}</h2>
            </div>
          </div>
          <IconButton onClick={onClose} tooltip={t('shortcuts.close')} aria-label={t('shortcuts.close')}>
            <X size={16} />
          </IconButton>
        </header>

        <div className="border-b border-border/80 px-5 py-3">
          <p className="text-sm leading-6 text-muted">{t('shortcuts.description')}</p>
          <label className="mt-3 flex items-center gap-2 rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5">
            <Search size={14} className="text-muted" />
            <input
              type="search"
              aria-label={t('shortcuts.searchLabel')}
              placeholder={t('shortcuts.searchPlaceholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
            />
          </label>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {matching.length === 0 ? (
            <p className="rounded-[1rem] border border-border/80 bg-background/65 px-3 py-3 text-sm text-muted">
              {t('shortcuts.empty', { query: query.trim() })}
            </p>
          ) : (
            <div className="grid gap-5">
              {SHORTCUT_GROUPS.map((group) => {
                const items = grouped.get(group.id);
                if (!items || items.length === 0) return null;
                return (
                  <section key={group.id} className="grid gap-2">
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
                      {t(group.labelKey)}
                    </h3>
                    <ul className="grid gap-1 rounded-[1.1rem] border border-border/80 bg-background/65">
                      {items.map((shortcut) => (
                        <li
                          key={shortcut.id}
                          className="flex items-center justify-between gap-4 border-b border-border/60 px-3 py-2 last:border-b-0"
                        >
                          <div className="grid gap-0.5 text-sm text-foreground">
                            <span>{t(shortcut.labelKey)}</span>
                            {shortcut.descriptionKey ? (
                              <span className="text-xs text-muted">
                                {t(shortcut.descriptionKey)}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {shortcut.combos.map((combo, index) => (
                              <kbd
                                key={`${shortcut.id}-combo-${index}`}
                                className="rounded-[0.65rem] border border-border/80 bg-surface-strong/85 px-2 py-0.5 font-mono text-[11px] text-foreground shadow-sm"
                              >
                                {formatShortcutCombo(combo, platform)}
                              </kbd>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
