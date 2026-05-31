import { Search } from 'lucide-react';
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
import { ModalShell, Kbd } from '../ui/ModalShell';
import { EyebrowMono } from '../ui/primitives';
import { cn } from '../../utils/cn';
import { fuzzyMatch } from '../../utils/fuzzyMatch';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUtilityHistoryStore } from '../../stores/utilityHistoryStore';
import { DeveloperUtilityPanel } from './UtilityPanels';
import { FavoriteToggleButton, FavoritesRow } from './FavoritesRow';
import { trackEvent } from '../../utils/telemetry';

/**
 * FASE 1 (MOV.01) — Developer utilities migrated onto the Signal-Slate
 * `ModalShell`.
 *
 * The overlay keeps its adaptive master-detail layout (searchable
 * sidebar + workspace panel) but now renders inside the canonical shell
 * instead of the bespoke `OverlayBackdrop`/`OverlayCard` chrome:
 *
 *   - HEADER → the shell's TITLE variant (title + subtitle) with the
 *     `x` close button (`headerClose="button"`). The two legacy
 *     `IconButton` close affordances (mobile + desktop) collapse into
 *     that single header `x`.
 *   - BODY → the master-detail grid passed as `children`, with
 *     `bodyClassName` removing the shell's default padding so the
 *     two-column layout owns its own gutters. The sidebar list and the
 *     workspace each scroll independently within the shell's body.
 *   - FOOTER → `footerLegend` carries the existing copy-output shortcut
 *     hint; `trailing` shows the live tool count.
 *
 * Everything the overlay *does* — fuzzy search, arrow-key navigation,
 * favorites, telemetry, the selected-utility workspace — is unchanged.
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

  // RL-069 Slice 3 — emit favorite-pinned telemetry from a one-shot
  // store subscription. We listen on the store so the trackEvent call
  // lives in one place even when the user pins from the sidebar OR
  // (potentially) from a future shortcut.
  useEffect(() => {
    let lastSize = useUtilityHistoryStore.getState().favorites.length;
    return useUtilityHistoryStore.subscribe((state) => {
      const nextSize = state.favorites.length;
      if (nextSize > lastSize) {
        const last = state.favorites[state.favorites.length - 1];
        if (last) {
          void trackEvent('utility.favorite.pinned', {
            utilityId: last,
            count: nextSize,
          });
        }
      }
      lastSize = nextSize;
    });
  }, []);

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

  const header = (
    <div className="min-w-0">
      <h2
        id="developer-utilities-modal-title"
        className="text-[16px] font-semibold leading-tight tracking-[-0.01em] text-fg-base"
      >
        {t('utilities.title')}
      </h2>
      <p className="mt-0.5 truncate text-[12.5px] text-fg-subtle">
        {t('utilities.description')}
      </p>
    </div>
  );

  const footerLegend = copyOutputShortcutHint ? (
    <span
      className="flex items-center gap-[6px] text-[11.5px] text-fg-subtle"
      aria-label={t('utilities.shortcuts.outputAriaLabel')}
      data-testid="utilities-sidebar-shortcuts"
    >
      <Kbd>{copyOutputShortcutHint.combo}</Kbd>
      {t(copyOutputShortcutHint.labelKey)}
    </span>
  ) : (
    <span />
  );

  const trailing = (
    <span className="font-mono text-[11px] text-fg-subtle">
      {t('utilities.toolCount', { count: DEVELOPER_UTILITIES.length })}
    </span>
  );

  return (
    <ModalShell
      onClose={onClose}
      size="max-w-[1120px]"
      labelledById="developer-utilities-modal-title"
      headerClose="button"
      closeLabel={t('utilities.close')}
      header={header}
      footerLegend={footerLegend}
      trailing={trailing}
      bodyClassName="h-[min(70vh,640px)] overflow-hidden"
    >
      <div
        data-testid="developer-utilities-modal"
        className="grid h-full grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]"
      >
        <aside className="flex min-h-0 flex-col border-b border-border-subtle lg:border-b-0 lg:border-r">
          <div className="px-4 pb-3 pt-4">
            <div className="relative">
              <Search
                size={13}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-fg-subtle"
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
                className="w-full rounded-full border border-border/60 bg-bg-panel/70 py-2 pl-10 pr-3 text-[12.5px] text-fg-base outline-none transition-colors placeholder:text-fg-subtle focus:border-accent/60"
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
          <FavoritesRow
            selectedUtilityId={selectedUtilityId}
            onSelect={setSelectedUtilityId}
          />
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {filteredUtilities.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <p className="text-[12px] text-fg-muted">
                  {t('utilities.search.empty', { query: searchQuery })}
                </p>
              </div>
            ) : (
              filteredUtilities.map((utility) => {
                const isSelected = utility.id === selectedUtilityId;
                return (
                  <div
                    key={utility.id}
                    className={cn(
                      'group mb-1 flex w-full items-start gap-1 rounded-xl pr-2 transition-colors',
                      isSelected
                        ? 'bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)]'
                        : 'hover:bg-bg-panel-alt/70'
                    )}
                  >
                    <button
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
                      className="flex flex-1 items-start gap-2.5 px-3 py-3 text-left"
                    >
                      <span
                        className={cn(
                          'mt-1.5 inline-block size-1.5 shrink-0 rounded-full',
                          isSelected ? 'bg-accent' : 'bg-transparent'
                        )}
                        aria-hidden="true"
                      />
                      <span className="flex flex-1 flex-col">
                        <span
                          className={cn(
                            'text-[13px] font-semibold leading-tight',
                            isSelected ? 'text-accent-fg' : 'text-fg-base'
                          )}
                        >
                          {t(utility.titleKey)}
                        </span>
                        <span
                          className={cn(
                            'mt-1 line-clamp-2 text-[11.5px] leading-[1.45]',
                            isSelected ? 'text-accent-fg/85' : 'text-fg-muted'
                          )}
                        >
                          {t(utility.descriptionKey)}
                        </span>
                      </span>
                    </button>
                    <FavoriteToggleButton utilityId={utility.id} />
                  </div>
                );
              })
            )}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col bg-bg-panel-alt/40">
          <div className="border-b border-border-subtle px-7 pb-5 pt-6">
            <EyebrowMono>{t('utilities.workspaceLabel')}</EyebrowMono>
            <h2 className="mt-1.5 text-[22px] font-bold leading-[1.15] tracking-[-0.01em] text-fg-base">
              {t(selectedUtility.titleKey)}
            </h2>
            <p className="mt-1 max-w-3xl text-[13px] leading-[1.55] text-fg-muted">
              {t(selectedUtility.descriptionKey)}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
            <DeveloperUtilityPanel toolId={selectedUtilityId} />
          </div>
        </main>
      </div>
    </ModalShell>
  );
}
