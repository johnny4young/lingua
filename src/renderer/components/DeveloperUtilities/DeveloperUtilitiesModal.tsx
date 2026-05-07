import { Search, Wrench, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KEYBOARD_SHORTCUTS,
  formatShortcutCombo,
  resolveCombos,
  resolveShortcutDisplayPlatform,
} from '../../data/keyboardShortcuts';
import {
  DEFAULT_DEVELOPER_UTILITY_ID,
  DEVELOPER_UTILITIES,
  findDeveloperUtility,
  type DeveloperUtilityDefinition,
  type DeveloperUtilityId,
} from '../../data/developerUtilities';
import { IconButton, OverlayBackdrop, OverlayCard } from '../ui/chrome';
import { Eyebrow } from '../ui/primitives';
import { cn } from '../../utils/cn';
import { fuzzyMatch } from '../../utils/fuzzyMatch';
import { useSettingsStore } from '../../stores/settingsStore';
import { DeveloperUtilityPanel } from './UtilityPanels';

/**
 * RL-070 Sub-slice 3 — Adaptive utilities layout.
 *
 * Changes from the original modal:
 *
 *   - Sidebar gains a search input that filters by title / description /
 *     keyword (the keywords already live on every utility definition).
 *   - Search empty state ("No utility matches «foo»") replaces the list
 *     when nothing matches; pressing Esc clears the query.
 *   - Modal grows to use the available viewport width (matches what
 *     SettingsModal does post-Sub-slice 2). Tall surfaces like the JWT
 *     debugger now have room for three columns without horizontal scroll
 *     even on 13" laptops.
 *   - Sidebar header uses the new Eyebrow primitive.
 *   - Selected-utility chip in the sidebar uses an accented dot for
 *     stronger visual anchoring instead of the previous bold-blue tint.
 */

interface DeveloperUtilitiesModalProps {
  onClose: () => void;
  initialUtilityId?: DeveloperUtilityId;
}

const COPY_OUTPUT_SHORTCUT_HINT = {
  id: 'utility-copy-output',
  labelKey: 'utilities.shortcuts.copyOutput',
} as const;

function getShortcutDisplayPlatform() {
  const runtimePlatform =
    typeof window !== 'undefined' ? window.lingua?.platform ?? 'web' : 'web';
  const navigatorPlatform =
    typeof navigator !== 'undefined' ? navigator.platform : undefined;
  return resolveShortcutDisplayPlatform(runtimePlatform, navigatorPlatform);
}

export function DeveloperUtilitiesModal({
  onClose,
  initialUtilityId = DEFAULT_DEVELOPER_UTILITY_ID,
}: DeveloperUtilitiesModalProps) {
  const { t } = useTranslation();
  const shortcutOverrides = useSettingsStore((state) => state.shortcutOverrides);
  const [selectedUtilityId, setSelectedUtilityId] =
    useState<DeveloperUtilityId>(initialUtilityId);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const utilityButtonRefs = useRef(new Map<DeveloperUtilityId, HTMLButtonElement>());

  const copyOutputShortcutHint = useMemo(() => {
    const displayPlatform = getShortcutDisplayPlatform();
    const definition = KEYBOARD_SHORTCUTS.find(
      (entry) => entry.id === COPY_OUTPUT_SHORTCUT_HINT.id
    );
    if (!definition) return null;
    const combo = resolveCombos(definition, shortcutOverrides)[0];
    if (!combo) return null;
    return {
      labelKey: COPY_OUTPUT_SHORTCUT_HINT.labelKey,
      combo: formatShortcutCombo(combo, displayPlatform),
    };
  }, [shortcutOverrides]);

  useEffect(() => {
    setSelectedUtilityId(initialUtilityId);
  }, [initialUtilityId]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const selectedUtility = findDeveloperUtility(selectedUtilityId);

  const filteredUtilities = useMemo(() => {
    const q = searchQuery.trim();
    if (q.length === 0) return DEVELOPER_UTILITIES;
    // RL-069 Slice 1 — fuzzy match against title, description,
    // keywords, and aliases. Score the best match across those fields
    // so a hit on the title outranks a hit on a tangential keyword.
    type Ranked = { utility: DeveloperUtilityDefinition; score: number };
    const ranked: Ranked[] = [];
    for (const utility of DEVELOPER_UTILITIES) {
      const title = t(utility.titleKey);
      const desc = t(utility.descriptionKey);
      const candidates: { value: string; weight: number }[] = [
        { value: title, weight: 1.0 },
        { value: desc, weight: 0.6 },
        ...utility.keywords.map((kw) => ({ value: kw, weight: 0.85 })),
        ...(utility.aliases ?? []).map((alias) => ({ value: alias, weight: 0.95 })),
      ];
      let best = -Infinity;
      for (const { value, weight } of candidates) {
        const score = fuzzyMatch(q, value);
        if (score === null) continue;
        const weighted = score * weight;
        if (weighted > best) best = weighted;
      }
      if (best > -Infinity) ranked.push({ utility, score: best });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked.map((r) => r.utility);
  }, [searchQuery, t]);

  useEffect(() => {
    if (filteredUtilities.length === 0) return;
    if (filteredUtilities.some((utility) => utility.id === selectedUtilityId)) return;
    const firstUtility = filteredUtilities[0];
    if (firstUtility) {
      setSelectedUtilityId(firstUtility.id);
    }
  }, [filteredUtilities, selectedUtilityId]);

  const focusUtilityButton = (utilityId: DeveloperUtilityId) => {
    window.requestAnimationFrame(() => {
      utilityButtonRefs.current.get(utilityId)?.focus();
    });
  };

  const selectUtilityAt = (index: number, shouldFocusButton: boolean) => {
    const utility = filteredUtilities[index];
    if (!utility) return;
    setSelectedUtilityId(utility.id);
    if (shouldFocusButton) {
      focusUtilityButton(utility.id);
    }
  };

  const selectRelativeUtility = (delta: number, shouldFocusButton: boolean) => {
    if (filteredUtilities.length === 0) return;
    const currentIndex = filteredUtilities.findIndex(
      (utility) => utility.id === selectedUtilityId
    );
    const fallbackIndex = delta > 0 ? -1 : 0;
    const baseIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
    const nextIndex =
      (baseIndex + delta + filteredUtilities.length) % filteredUtilities.length;
    selectUtilityAt(nextIndex, shouldFocusButton);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && searchQuery.length > 0) {
      event.stopPropagation();
      setSearchQuery('');
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      selectRelativeUtility(event.key === 'ArrowDown' ? 1 : -1, true);
      return;
    }
    if (event.key === 'Enter' && filteredUtilities.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      const currentIndex = filteredUtilities.findIndex(
        (utility) => utility.id === selectedUtilityId
      );
      selectUtilityAt(Math.max(currentIndex, 0), true);
    }
  };

  const handleUtilityKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      selectRelativeUtility(event.key === 'ArrowDown' ? 1 : -1, true);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      selectUtilityAt(0, true);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      selectUtilityAt(filteredUtilities.length - 1, true);
      return;
    }
    if (event.key === 'Escape' && searchQuery.length > 0) {
      event.stopPropagation();
      setSearchQuery('');
      searchRef.current?.focus();
    }
  };

  return (
    <OverlayBackdrop onClose={onClose}>
      <OverlayCard
        role="dialog"
        aria-modal="true"
        aria-labelledby="developer-utilities-modal-title"
        data-testid="developer-utilities-modal"
        className="relative flex h-[min(86vh,860px)] w-[min(96vw,1480px)] max-w-none flex-col overflow-hidden lg:flex-row"
      >
        <aside className="flex w-full shrink-0 flex-col border-b border-border/80 bg-background/55 lg:w-[320px] lg:border-b-0 lg:border-r">
          <div className="surface-header px-5 pt-5 pb-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[1rem] bg-primary-soft text-primary">
                  <Wrench size={18} />
                </div>
                <div>
                  <Eyebrow className="mb-0.5">{t('utilities.panelTitle')}</Eyebrow>
                  <h2
                    id="developer-utilities-modal-title"
                    className="text-sm font-semibold text-foreground"
                  >
                    {t('utilities.title')}
                  </h2>
                </div>
              </div>
              <IconButton
                onClick={onClose}
                tooltip={t('utilities.close')}
                aria-label={t('utilities.close')}
                className="lg:hidden"
              >
                <X size={16} />
              </IconButton>
            </div>
            <p className="mb-3 text-[12px] leading-[1.5] text-muted">
              {t('utilities.description')}
            </p>
            {copyOutputShortcutHint ? (
              <div
                className="mb-3 flex flex-wrap items-center gap-2"
                aria-label={t('utilities.shortcuts.outputAriaLabel')}
                data-testid="utilities-sidebar-shortcuts"
              >
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/70 px-2.5 py-1 text-[11px] leading-none text-muted">
                  <span>{t(copyOutputShortcutHint.labelKey)}</span>
                  <span className="kbd-shell border-border/70 bg-background-elevated text-[10px] text-foreground">
                    {copyOutputShortcutHint.combo}
                  </span>
                </span>
              </div>
            ) : null}
            <div className="relative">
              <Search
                size={12}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                ref={searchRef}
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t('utilities.search.placeholder')}
                aria-label={t('utilities.search.ariaLabel')}
                data-testid="utilities-search-input"
                className="w-full rounded-[0.85rem] border border-border/80 bg-background-elevated/88 px-8 py-1.5 text-[12px] text-foreground outline-none transition-colors placeholder:text-muted focus:border-primary/50"
              />
              {searchQuery.length > 0 ? (
                <span
                  className="kbd-shell absolute right-2 top-1/2 -translate-y-1/2"
                  aria-label={t('utilities.search.escHint')}
                >
                  {t('shortcuts.kbd.escape')}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {filteredUtilities.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <p className="text-[12px] text-muted">
                  {t('utilities.search.empty', { query: searchQuery })}
                </p>
              </div>
            ) : (
              filteredUtilities.map((utility) => {
                const isSelected = utility.id === selectedUtilityId;
                return (
                  <button
                    key={utility.id}
                    type="button"
                    ref={(node) => {
                      if (node) {
                        utilityButtonRefs.current.set(utility.id, node);
                      } else {
                        utilityButtonRefs.current.delete(utility.id);
                      }
                    }}
                    onClick={() => setSelectedUtilityId(utility.id)}
                    onKeyDown={handleUtilityKeyDown}
                    aria-pressed={isSelected}
                    data-testid={`utility-item-${utility.id}`}
                    className={cn(
                      'mb-1 flex w-full items-start gap-2.5 rounded-[1rem] px-3 py-2.5 text-left transition-colors',
                      isSelected
                        ? 'bg-primary-soft'
                        : 'hover:bg-surface-strong/72'
                    )}
                  >
                    <span
                      className={cn(
                        'mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                        isSelected ? 'bg-primary' : 'bg-transparent'
                      )}
                      aria-hidden="true"
                    />
                    <span className="flex flex-col">
                      <span
                        className={cn(
                          'text-[13px] font-semibold leading-tight',
                          isSelected ? 'text-primary' : 'text-foreground'
                        )}
                      >
                        {t(utility.titleKey)}
                      </span>
                      <span
                        className={cn(
                          'mt-0.5 text-[11.5px] leading-[1.45]',
                          isSelected ? 'text-primary/80' : 'text-muted'
                        )}
                      >
                        {t(utility.descriptionKey)}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <main className="flex min-h-0 flex-1 flex-col bg-surface/38">
          <div className="surface-header flex items-start justify-between px-6 pt-5 pb-4">
            <div className="grid gap-1">
              <Eyebrow className="mb-0">{t('utilities.workspaceLabel')}</Eyebrow>
              <h2 className="font-display text-[22px] font-semibold leading-[1.2] tracking-[-0.02em] text-foreground">
                {t(selectedUtility.titleKey)}
              </h2>
              <p className="mt-1 max-w-3xl text-[12.5px] leading-[1.5] text-muted">
                {t(selectedUtility.descriptionKey)}
              </p>
            </div>
            <IconButton
              onClick={onClose}
              tooltip={t('utilities.close')}
              aria-label={t('utilities.close')}
              className="hidden lg:inline-flex"
            >
              <X size={16} />
            </IconButton>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <DeveloperUtilityPanel toolId={selectedUtilityId} />
          </div>
        </main>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
