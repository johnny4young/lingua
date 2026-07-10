import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_DEVELOPER_UTILITY_ID,
  DEVELOPER_UTILITIES,
  findDeveloperUtility,
  type DeveloperUtilityDefinition,
  type DeveloperUtilityId,
} from '../../data/developerUtilities';
import { ModalShell } from '../ui/ModalShell';
import { cn } from '../../utils/cn';
import { fuzzyMatch } from '../../utils/fuzzyMatch';
import { useUtilityHistoryStore } from '../../stores/utilityHistoryStore';
import { DeveloperUtilityPanel } from './UtilityPanels';
import { prefetchUtilityPanel } from './UtilityPanelRegistry';
import { FavoriteToggleButton, FavoritesRow } from './FavoritesRow';
import { UtilityCopyShortcutHint } from './UtilityHeaderPills';
import { trackEvent } from '../../utils/telemetry';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import { pushUpsellNotice } from '../../utils/upsellNotice';

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
 *
 * MOV.03 — the same master/detail body is also exported as
 * `<DeveloperUtilitiesWorkspaceView>` so Utilities can live as a full-screen
 * editor workspace tab without duplicating the 30-panel picker logic.
 */

interface DeveloperUtilitiesModalProps {
  onClose: () => void;
  initialUtilityId?: DeveloperUtilityId;
}

function useFavoriteTelemetry(): void {
  // RL-069 Slice 3 — emit favorite-pinned telemetry from a one-shot
  // store subscription. We listen on the store so the trackEvent call
  // lives in one place even when the user pins from the sidebar OR
  // (potentially) from a future shortcut.
  useEffect(() => {
    let lastSize = useUtilityHistoryStore.getState().favorites.length;
    return useUtilityHistoryStore.subscribe(state => {
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
}

interface DeveloperUtilitiesWorkspaceBodyProps {
  selectedUtilityId: DeveloperUtilityId;
  onSelectUtility: (utilityId: DeveloperUtilityId) => void;
  autoFocusSearch?: boolean;
  testId?: string;
  className?: string;
  active?: boolean;
}

export function DeveloperUtilitiesWorkspaceBody({
  selectedUtilityId,
  onSelectUtility,
  autoFocusSearch = true,
  testId = 'developer-utilities-workspace-body',
  className = 'grid h-full grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]',
  active = true,
}: DeveloperUtilitiesWorkspaceBodyProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [visitedUtilityIds, setVisitedUtilityIds] = useState<DeveloperUtilityId[]>(() => [
    selectedUtilityId,
  ]);
  // The active utility can also change from OUTSIDE the sidebar handlers
  // (the command palette's Open JWT Debugger writes activeUtilityId
  // straight to the store), so remember every id that becomes selected —
  // otherwise a palette-opened panel never joins the keep-mounted cache
  // and its draft is discarded on the next in-sidebar navigation.
  // Render-time state adjustment (guarded) instead of an effect: React
  // re-renders immediately with the appended id, before children commit.
  if (!visitedUtilityIds.includes(selectedUtilityId)) {
    setVisitedUtilityIds([...visitedUtilityIds, selectedUtilityId]);
  }
  const searchRef = useRef<HTMLInputElement>(null);
  const effectiveTier = useEffectiveTier();
  const canUseUtilityWorkflows = useEntitlement('DEV_UTILITIES');
  // Button refs let keyboard navigation move actual focus into the list
  // after a search-box arrow key, matching a roving-tabindex pattern
  // without storing focus state separately.
  const utilityButtonRefs = useRef(new Map<DeveloperUtilityId, HTMLButtonElement>());

  useFavoriteTelemetry();

  useEffect(() => {
    if (autoFocusSearch) {
      searchRef.current?.focus();
    }
  }, [autoFocusSearch]);

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
        ...utility.keywords.map(kw => ({ value: kw, weight: 0.85 })),
        ...(utility.aliases ?? []).map(alias => ({ value: alias, weight: 0.95 })),
      ];
      let best = -Infinity;
      for (const { value, weight } of candidates) {
        const score = fuzzyMatch(q, value);
        if (score === null) continue;
        // Weighting keeps aliases and titles ahead of broad description hits
        // while still allowing keyword-only discovery.
        const weighted = score * weight;
        if (weighted > best) best = weighted;
      }
      if (best > -Infinity) ranked.push({ utility, score: best });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked.map(r => r.utility);
  }, [searchQuery, t]);

  const isUtilityLocked = (utility: DeveloperUtilityDefinition): boolean =>
    utility.requiresEntitlement === 'DEV_UTILITIES' && !canUseUtilityWorkflows;

  const notifyLockedUtility = () => {
    pushUpsellNotice({
      messageKey: 'upsell.freeCeilingReached',
      featureLabel: t('upsell.feature.utilityWorkflows'),
    });
    void trackEvent('feature.blocked', {
      entitlement: 'utility-workflows',
      tier: effectiveTier,
    });
  };

  const rememberUtility = (utilityId: DeveloperUtilityId) => {
    setVisitedUtilityIds(current =>
      current.includes(utilityId) ? current : [...current, utilityId]
    );
  };

  const selectUtility = (utilityId: DeveloperUtilityId) => {
    rememberUtility(utilityId);
    onSelectUtility(utilityId);
  };

  const activeSelectedUtilityId = selectedUtilityId;
  // `selectedUtility` never falls back to null because the catalog owns
  // DEFAULT_DEVELOPER_UTILITY_ID and `activeSelectedUtilityId` preserves the
  // last known id when a search produces no rows.
  const selectedUtility = findDeveloperUtility(activeSelectedUtilityId);

  const focusUtilityButton = (utilityId: DeveloperUtilityId) => {
    // Defer until React has committed the filtered list; otherwise the ref
    // can still point at a pre-filter button that is about to unmount.
    window.requestAnimationFrame(() => {
      utilityButtonRefs.current.get(utilityId)?.focus();
    });
  };

  const selectUtilityAt = (index: number, shouldFocusButton: boolean) => {
    const utility = filteredUtilities[index];
    if (!utility) return;
    if (isUtilityLocked(utility)) {
      selectUtility(utility.id);
      notifyLockedUtility();
      if (shouldFocusButton) {
        focusUtilityButton(utility.id);
      }
      return;
    }
    selectUtility(utility.id);
    if (shouldFocusButton) {
      focusUtilityButton(utility.id);
    }
  };

  const handleSelectUtility = (utilityId: DeveloperUtilityId) => {
    const utility = findDeveloperUtility(utilityId);
    if (isUtilityLocked(utility)) {
      selectUtility(utilityId);
      notifyLockedUtility();
      return;
    }
    selectUtility(utilityId);
  };

  const selectRelativeUtility = (delta: number, shouldFocusButton: boolean) => {
    if (filteredUtilities.length === 0) return;
    const currentIndex = filteredUtilities.findIndex(
      utility => utility.id === activeSelectedUtilityId
    );
    const fallbackIndex = delta > 0 ? -1 : 0;
    const baseIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
    const nextIndex = (baseIndex + delta + filteredUtilities.length) % filteredUtilities.length;
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
      // Arrowing from the search field selects and focuses a concrete tool
      // row so subsequent Home/End/Escape behavior belongs to the list.
      selectRelativeUtility(event.key === 'ArrowDown' ? 1 : -1, true);
      return;
    }
    if (event.key === 'Enter' && filteredUtilities.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      const currentIndex = filteredUtilities.findIndex(
        utility => utility.id === activeSelectedUtilityId
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
    <div data-testid={testId} className={className}>
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
              onChange={event => setSearchQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t('utilities.search.placeholder')}
              aria-label={t('utilities.search.ariaLabel')}
              data-testid="utilities-search-input"
              className="w-full rounded-full border border-border/60 bg-bg-panel/70 py-2 pl-10 pr-3 text-body-sm text-fg-base outline-none transition-colors placeholder:text-fg-subtle focus:border-accent/60"
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
        <FavoritesRow selectedUtilityId={activeSelectedUtilityId} onSelect={handleSelectUtility} />
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filteredUtilities.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-body-sm text-fg-muted">
                {t('utilities.search.empty', { query: searchQuery })}
              </p>
            </div>
          ) : (
            filteredUtilities.map(utility => {
              const isSelected = utility.id === activeSelectedUtilityId;
              const isLocked = isUtilityLocked(utility);
              return (
                <div
                  key={utility.id}
                  data-locked={isLocked || undefined}
                  className={cn(
                    'group mb-1 flex w-full items-start gap-1 rounded-xl pr-2 transition-colors',
                    isSelected
                      ? 'bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)]'
                      : 'hover:bg-bg-panel-alt/70',
                    isLocked && 'opacity-75'
                  )}
                >
                  <button
                    type="button"
                    ref={node => {
                      if (node) {
                        utilityButtonRefs.current.set(utility.id, node);
                      } else {
                        utilityButtonRefs.current.delete(utility.id);
                      }
                    }}
                    onClick={() => {
                      if (isLocked) {
                        selectUtility(utility.id);
                        notifyLockedUtility();
                        return;
                      }
                      selectUtility(utility.id);
                    }}
                    onKeyDown={handleUtilityKeyDown}
                    onMouseEnter={() => {
                      if (!isLocked) prefetchUtilityPanel(utility.id);
                    }}
                    onFocus={() => {
                      if (!isLocked) prefetchUtilityPanel(utility.id);
                    }}
                    aria-pressed={isSelected}
                    data-testid={`utility-item-${utility.id}`}
                    className={cn(
                      'flex flex-1 items-start gap-2.5 px-3 py-3 text-left',
                      isLocked && 'cursor-pointer'
                    )}
                  >
                    <span
                      className={cn(
                        'mt-1.5 inline-block size-1.5 shrink-0 rounded-full',
                        isSelected ? 'bg-accent' : 'bg-transparent'
                      )}
                      aria-hidden="true"
                    />
                    <span className="flex flex-1 flex-col">
                      <span className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            'text-body font-semibold leading-tight',
                            isSelected ? 'text-accent-fg' : 'text-fg-base'
                          )}
                        >
                          {t(utility.titleKey)}
                        </span>
                        {isLocked ? (
                          <span
                            data-testid={`utility-lock-${utility.id}`}
                            className="rounded-full border border-warning/45 bg-warning/10 px-1.5 py-0.5 font-mono text-micro font-bold uppercase tracking-[0.16em] text-warning"
                          >
                            {t('utilities.locked.proBadge')}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          'mt-1 line-clamp-2 text-caption leading-[1.45]',
                          isSelected ? 'text-accent-fg/85' : 'text-fg-muted'
                        )}
                      >
                        {t(utility.descriptionKey)}
                      </span>
                    </span>
                  </button>
                  {isLocked ? null : <FavoriteToggleButton utilityId={utility.id} />}
                </div>
              );
            })
          )}
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col bg-bg-panel-alt/40">
        {/* Space-saving header: the utility is already identified by the
            selected sidebar item, so the big title collapses to an
            sr-only heading (screen readers and heading-based tests keep
            their landmark) and only the one-line description renders. */}
        <div className="border-b border-border-subtle px-7 py-3">
          <h2 className="sr-only">{t(selectedUtility.titleKey)}</h2>
          <p className="max-w-3xl text-body-sm leading-[1.5] text-fg-muted">
            {t(selectedUtility.descriptionKey)}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
          <DeveloperUtilityPanel
            toolId={activeSelectedUtilityId}
            mountedToolIds={visitedUtilityIds}
            active={active}
          />
        </div>
      </main>
    </div>
  );
}

export function DeveloperUtilitiesModal({
  onClose,
  initialUtilityId = DEFAULT_DEVELOPER_UTILITY_ID,
}: DeveloperUtilitiesModalProps) {
  const { t } = useTranslation();
  const [selectedUtilityId, setSelectedUtilityId] = useState<DeveloperUtilityId>(initialUtilityId);

  const header = (
    <div className="min-w-0">
      <h2
        id="developer-utilities-modal-title"
        className="text-body-lg font-semibold leading-tight tracking-[-0.01em] text-fg-base"
      >
        {t('utilities.title')}
      </h2>
      <p className="mt-0.5 truncate text-body-sm text-fg-subtle">{t('utilities.description')}</p>
    </div>
  );

  const footerLegend = <UtilityCopyShortcutHint />;

  const trailing = (
    <span className="font-mono text-caption text-fg-subtle">
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
      <DeveloperUtilitiesWorkspaceBody
        selectedUtilityId={selectedUtilityId}
        onSelectUtility={setSelectedUtilityId}
        testId="developer-utilities-modal"
      />
    </ModalShell>
  );
}

export function DeveloperUtilitiesWorkspaceView({ active = true }: { active?: boolean }) {
  const activeUtilityId = useUtilityHistoryStore(state => state.activeUtilityId);
  const setActiveUtilityId = useUtilityHistoryStore(state => state.setActiveUtilityId);

  return (
    <div
      data-testid="developer-utilities-workspace"
      className="flex h-full min-h-0 flex-col bg-bg-panel-alt/40"
    >
      {/* No workspace-local header: the copy-output hint and the tool
          counter render in the shell's editor chips row (one shared row)
          via UtilityHeaderPills — see AppLayout's PanelChipsRow trailing. */}
      <DeveloperUtilitiesWorkspaceBody
        selectedUtilityId={activeUtilityId}
        onSelectUtility={setActiveUtilityId}
        testId="developer-utilities-workspace-body"
        className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]"
        active={active}
      />
    </div>
  );
}
