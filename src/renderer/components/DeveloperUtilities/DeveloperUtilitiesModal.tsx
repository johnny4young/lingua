import { PanelLeft, Search, Workflow } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_DEVELOPER_UTILITY_ID,
  DEVELOPER_UTILITIES,
  findDeveloperUtility,
  type DeveloperUtilityDefinition,
  type DeveloperUtilityId,
} from '../../data/developerUtilities';
import {
  CATEGORY_SORTED_UTILITIES,
  UTILITY_CATEGORY,
  type UtilityCategory,
} from '../../data/utilityCategories';
import { ModalShell } from '../ui/ModalShell';
import { Tooltip } from '../ui/chrome';
import { DotLeader } from '../ui/answer';
import { useShortcutLabel } from '../../hooks/useShortcutLabel';
import { useWidthTier } from '../../hooks/useWidthTier';
import { SendOutputSelect } from './SendOutputSelect';
import { UtilityRail } from './UtilityRail';
import { fuzzyMatch } from '../../utils/fuzzyMatch';
import { formatNumber } from '../../i18n/formatNumber';
import { useUtilityHistoryStore } from '../../stores/utilityHistoryStore';
import { useUtilityPipelineStore } from '../../stores/utilityPipelineStore';
import { useUtilityWorkspaceStore } from '../../stores/utilityWorkspaceStore';
import { DeveloperUtilityPanel } from './UtilityPanels';
import { FavoriteToggleButton } from './FavoritesRow';
import { UtilityCopyShortcutHint } from './UtilityHeaderPills';
import { CLIPBOARD_TOOLS, clipboardGroup } from '../../data/clipboardTools';
import { useClipboardSuggestion } from '../../hooks/useClipboardSuggestion';
import { useLauncherPreviews } from './useLauncherPreviews';
import { UtilityLauncherList } from './UtilityLauncherList';
import { UtilityLauncherRow } from './UtilityLauncherRow';
import { useUIStore } from '../../stores/uiStore';
import { useUtilityOutputStore } from '../../stores/utilityOutputStore';
import { sendOutputToNewPipeline } from '../../stores/utilityPipelineSend';
import type { UtilityAdapterId } from '../../../shared/utilities/types';
import { useTelemetry } from '../../hooks/useTelemetry';
import { CommandBarSlotScope } from '../Chrome/commandBarSlotScope';
import { cn } from '../../utils/cn';

/**
 * Developer utilities migrated onto the Signal-Slate
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
 * The same master/detail body is also exported as
 * `<DeveloperUtilitiesWorkspaceView>` so Utilities can live as a full-screen
 * editor workspace tab without duplicating the 30-panel picker logic.
 */

interface DeveloperUtilitiesModalProps {
  onClose: () => void;
  initialUtilityId?: DeveloperUtilityId;
}

function useFavoriteTelemetry(): void {
  const { track } = useTelemetry();
  // Emit favorite-pinned telemetry from a one-shot
  // store subscription. We listen on the store so the telemetry call
  // lives in one place even when the user pins from the sidebar OR
  // (potentially) from a future shortcut.
  useEffect(() => {
    let lastSize = useUtilityHistoryStore.getState().favorites.length;
    return useUtilityHistoryStore.subscribe(state => {
      const nextSize = state.favorites.length;
      // During a rehydrate the pin came from another tab, which already reported it.
      if (nextSize > lastSize && useUtilityHistoryStore.persist?.hasHydrated() !== false) {
        const last = state.favorites[state.favorites.length - 1];
        if (last) {
          track('utility.favorite.pinned', {
            utilityId: last,
            count: nextSize,
          });
        }
      }
      lastSize = nextSize;
    });
  }, [track]);
}

const NO_TOOLS: readonly DeveloperUtilityId[] = [];

/** Below this tab width the open list takes the whole tab. */
const NARROW_TAB_WIDTHS = [600];

interface ToolListControl {
  open: boolean;
  setOpen: (open: boolean) => void;
}

interface DeveloperUtilitiesWorkspaceBodyProps {
  selectedUtilityId: DeveloperUtilityId;
  onSelectUtility: (utilityId: DeveloperUtilityId) => void;
  autoFocusSearch?: boolean;
  testId?: string;
  className?: string;
  active?: boolean;
  /** The workspace tab folds its list to an icon rail; the modal keeps the full list. */
  toolList?: ToolListControl;
}

function DeveloperUtilitiesWorkspaceBody({
  selectedUtilityId,
  onSelectUtility,
  autoFocusSearch = true,
  testId = 'developer-utilities-workspace-body',
  className = 'grid h-full grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]',
  active = true,
  toolList,
}: DeveloperUtilitiesWorkspaceBodyProps) {
  const { t, i18n } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [visitedUtilityIds, setVisitedUtilityIds] = useState<DeveloperUtilityId[]>(() => [
    selectedUtilityId,
  ]);
  // The active utility can also change from OUTSIDE the sidebar handlers
  // (the command palette's Open JWT Debugger writes activeUtilityId
  // straight to the store), so remember every id that becomes selected —
  // otherwise a palette-opened panel never joins the keep-mounted cache
  // and its draft is discarded on the next in-sidebar navigation.
  //
  // This is React's documented adjust-state-when-a-prop-changes pattern
  // (react.dev "You Might Not Need an Effect", storing information from
  // previous renders): a GUARDED setState during render makes React
  // restart this component's render immediately with the appended id —
  // no children commit in between, no extra effect pass, and the
  // `includes` guard guarantees convergence (StrictMode's double render
  // takes the guard branch on the second pass). The obvious alternative
  // — a useEffect keyed on selectedUtilityId — is rejected by this
  // repo's react-compiler lint (setState-in-effect cascades a second
  // full render+commit) and was reverted to this form on purpose.
  if (!visitedUtilityIds.includes(selectedUtilityId)) {
    setVisitedUtilityIds([...visitedUtilityIds, selectedUtilityId]);
  }
  const searchRef = useRef<HTMLInputElement>(null);
  const peek = useClipboardSuggestion(active);
  const favorites = useUtilityHistoryStore(state => state.favorites);
  const pipelineCount = useUtilityPipelineStore(state => state.pipelines.length);
  // Tool panels load lazily and register their output once mounted.
  const outputReady = useUtilityOutputStore(state => state.provider !== null);
  const suggestedTools = peek ? CLIPBOARD_TOOLS[peek.kind] : NO_TOOLS;
  const clipboardTools = useMemo(() => (peek ? clipboardGroup(peek.kind) : NO_TOOLS), [peek]);

  useFavoriteTelemetry();

  useEffect(() => {
    if (autoFocusSearch) {
      searchRef.current?.focus();
    }
  }, [autoFocusSearch]);

  const browsing = searchQuery.trim().length === 0;
  // Previews are read only while the clipboard group is on screen.
  const previews = useLauncherPreviews(browsing && toolList?.open !== false ? peek : null);

  const filteredUtilities = useMemo(() => {
    const q = searchQuery.trim();
    // Browsing, arrow keys walk the rows top to bottom: clipboard tools,
    // favorites, then every category, each tool once. Search stays rank-ordered.
    if (q.length === 0) {
      const ids = new Set<DeveloperUtilityId>([
        ...clipboardTools,
        ...favorites,
        ...CATEGORY_SORTED_UTILITIES.map(utility => utility.id),
      ]);
      return [...ids].map(findDeveloperUtility);
    }
    // Fuzzy match against title, description,
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
  }, [searchQuery, t, clipboardTools, favorites]);

  // A tool listed under the clipboard or Favorites already has a row, so its category stays as it is.
  const listedAbove = (utilityId: DeveloperUtilityId) =>
    clipboardTools.includes(utilityId) || favorites.includes(utilityId);

  const [expanded, setExpanded] = useState<ReadonlySet<UtilityCategory>>(() =>
    listedAbove(selectedUtilityId) ? new Set() : new Set([UTILITY_CATEGORY[selectedUtilityId]])
  );
  const expandCategory = (category: UtilityCategory) => {
    setExpanded(current => (current.has(category) ? current : new Set([...current, category])));
  };
  const toggleCategory = (category: UtilityCategory) => {
    setExpanded(current => {
      const next = new Set(current);
      if (!next.delete(category)) next.add(category);
      return next;
    });
  };
  // A tool opened from outside the list (palette, rail) shows its row:
  // the same guarded adjust-during-render as the visited ids above.
  const [shownUtilityId, setShownUtilityId] = useState(selectedUtilityId);
  if (shownUtilityId !== selectedUtilityId) {
    setShownUtilityId(selectedUtilityId);
    if (!listedAbove(selectedUtilityId)) expandCategory(UTILITY_CATEGORY[selectedUtilityId]);
  }

  const compact = toolList !== undefined;
  const toggleCombo = useShortcutLabel('view-toggle-sidebar') ?? '';
  const pipelinesCombo = useShortcutLabel('action-open-utility-pipelines');
  const listRef = useRef<HTMLDivElement>(null);
  const openListAt = (focus: 'search' | 'favorites' | UtilityCategory) => {
    toolList?.setOpen(true);
    if (focus !== 'search' && focus !== 'favorites') expandCategory(focus);
    window.requestAnimationFrame(() => {
      if (focus === 'search') {
        searchRef.current?.focus();
        return;
      }
      if (focus === 'favorites') {
        listRef.current?.scrollTo({ top: 0 });
        return;
      }
      listRef.current
        ?.querySelector(`[data-testid="utility-category-${focus}"]`)
        ?.scrollIntoView({ block: 'start' });
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

  // A narrow tab shows the open list in place of the tool; picking one shows the tool.
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabTier = useWidthTier(bodyRef, NARROW_TAB_WIDTHS, 1);
  const narrow = compact && tabTier === 0;
  const pickUtility = (utilityId: DeveloperUtilityId) => {
    selectUtility(utilityId);
    if (narrow) toolList?.setOpen(false);
  };

  const activeSelectedUtilityId = selectedUtilityId;
  // `selectedUtility` never falls back to null because the catalog owns
  // DEFAULT_DEVELOPER_UTILITY_ID and `activeSelectedUtilityId` preserves the
  // last known id when a search produces no rows.
  const selectedUtility = findDeveloperUtility(activeSelectedUtilityId);

  const focusUtilityButton = (utilityId: DeveloperUtilityId) => {
    // Defer until React has committed the list. The first row in DOM order is
    // the one arrow keys walk: clipboard, then Favorites, then its category.
    window.requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLButtonElement>(`[data-utility-id="${utilityId}"]`)?.focus();
    });
  };

  const selectUtilityAt = (index: number, shouldFocusButton: boolean) => {
    const utility = filteredUtilities[index];
    if (!utility) return;
    selectUtility(utility.id);
    if (shouldFocusButton) {
      focusUtilityButton(utility.id);
    }
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
      if (narrow) toolList?.setOpen(false);
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

  const handleSendOutput = (utilityId: UtilityAdapterId) => {
    const output = useUtilityOutputStore.getState().getProvider()?.() ?? '';
    const notice = (messageKey: string) => useUIStore.getState().pushStatusNotice({ tone: 'warning', messageKey });
    if (output.length === 0) {
      notice('utilityPipeline.send.empty');
    } else if (!sendOutputToNewPipeline(output, utilityId, t(selectedUtility.titleKey))) {
      notice('utilityPipeline.send.capReached');
    } else {
      selectUtility('utility-pipelines');
    }
  };

  const panel = (
    <main className={cn('flex min-h-0 min-w-0 flex-1 flex-col bg-bg-panel-alt/40', narrow && toolList?.open && 'hidden')}>
      {/* The selected sidebar row already shows this utility's title and
          description, and the panel below opens with its own heading, so a
          third copy of the description bought nothing but a bordered band.
          The heading stays as a visually hidden landmark for screen readers
          and heading-based tests. */}
      <h2 className="sr-only">{t(selectedUtility.titleKey)}</h2>
      {activeSelectedUtilityId !== 'utility-pipelines' ? (
        <div className="flex justify-end px-7 pt-3">
          <SendOutputSelect testId="utility-send-output" ready={outputReady} onSend={handleSendOutput} />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
        <DeveloperUtilityPanel
          toolId={activeSelectedUtilityId}
          mountedToolIds={visitedUtilityIds}
          active={active}
        />
      </div>
    </main>
  );

  if (toolList && !toolList.open) {
    return (
      <div ref={bodyRef} data-testid={testId} data-tool-list="rail" className="flex min-h-0 flex-1">
        <UtilityRail
          activeCategory={UTILITY_CATEGORY[activeSelectedUtilityId]}
          pipelinesActive={activeSelectedUtilityId === 'utility-pipelines'}
          suggestedCategories={new Set(suggestedTools.map(toolId => UTILITY_CATEGORY[toolId]))}
          onSearch={() => openListAt('search')}
          onFavorites={() => openListAt('favorites')}
          onCategory={category => openListAt(category)}
          onPipelines={() => selectUtility('utility-pipelines')}
          onExpand={() => toolList.setOpen(true)}
        />
        {panel}
      </div>
    );
  }

  const pipelinesSelected = activeSelectedUtilityId === 'utility-pipelines';

  return (
    <div
      ref={bodyRef}
      data-testid={testId}
      data-tool-list={compact ? 'open' : undefined}
      className={compact ? 'flex min-h-0 flex-1' : className}
    >
      <aside
        className={cn(
          'flex min-h-0 flex-col border-b border-border-subtle lg:border-b-0 lg:border-r',
          compact && 'launcher-list shrink-0 border-b-0 border-r bg-bg-panel',
          narrow && 'launcher-list-full'
        )}
      >
        <div className="px-3 pb-2 pt-3">
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle"
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
              className="launcher-search w-full border border-border-default bg-bg-inset pl-8 pr-3 text-body-sm text-fg-base outline-none transition-colors placeholder:text-fg-subtle focus:border-accent/60"
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
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-2">
          {browsing ? (
            <UtilityLauncherList
              selectedUtilityId={activeSelectedUtilityId}
              onSelect={pickUtility}
              onRowKeyDown={handleUtilityKeyDown}
              peek={peek}
              clipboardTools={clipboardTools}
              previews={previews}
              expanded={expanded}
              onToggleCategory={toggleCategory}
              active={active}
            />
          ) : filteredUtilities.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-body-sm text-fg-muted">
                {t('utilities.search.empty', { query: searchQuery })}
              </p>
            </div>
          ) : (
            <ul aria-label={t('utilities.search.ariaLabel')}>
              {filteredUtilities.map(utility => (
                <li key={utility.id}>
                  <UtilityLauncherRow
                    utilityId={utility.id}
                    selected={utility.id === activeSelectedUtilityId}
                    testId={`utility-item-${utility.id}`}
                    onSelect={pickUtility}
                    onKeyDown={handleUtilityKeyDown}
                    suggested={suggestedTools.includes(utility.id)}
                    actions={<FavoriteToggleButton utilityId={utility.id} />}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="launcher-footer">
          <div className="launcher-row min-w-0 flex-1" data-selected={pipelinesSelected || undefined}>
            <button
              type="button"
              className="launcher-row-main"
              aria-pressed={pipelinesSelected}
              data-testid="utility-launcher-pipelines"
              onClick={() => pickUtility('utility-pipelines')}
            >
              <Workflow size={14} strokeWidth={1.6} aria-hidden className="launcher-row-icon" />
              <span className="launcher-row-name">{t('utilities.tool.utilityPipelines.titleLabel')}</span>
              <DotLeader className="launcher-row-leader" />
              {pipelineCount > 0 ? (
                <span className="launcher-count" data-testid="utility-launcher-pipelines-count">
                  {formatNumber(pipelineCount, i18n.language)}
                </span>
              ) : null}
              {pipelinesCombo ? <kbd className="launcher-kbd">{pipelinesCombo}</kbd> : null}
            </button>
          </div>
          {toolList ? (
            <Tooltip content={t('utilities.list.collapse', { combo: toggleCombo })} side="top">
              <button
                type="button"
                data-testid="utility-list-collapse"
                aria-label={t('utilities.list.collapse', { combo: toggleCombo })}
                onClick={() => toolList.setOpen(false)}
                className="icon-button size-7 rounded-md"
              >
                <PanelLeft size={14} aria-hidden />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </aside>
      {panel}
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
    </div>
  );

  const footerLegend = <UtilityCopyShortcutHint />;


  return (
    <ModalShell
      onClose={onClose}
      size="max-w-[1120px]"
      labelledById="developer-utilities-modal-title"
      headerClose="button"
      closeLabel={t('utilities.close')}
      header={header}
      footerLegend={footerLegend}
      bodyClassName="h-[min(70vh,640px)] overflow-hidden"
    >
      <CommandBarSlotScope value="inline">
        <DeveloperUtilitiesWorkspaceBody
          selectedUtilityId={selectedUtilityId}
          onSelectUtility={setSelectedUtilityId}
          testId="developer-utilities-modal"
        />
      </CommandBarSlotScope>
    </ModalShell>
  );
}

export function DeveloperUtilitiesWorkspaceView({ active = true }: { active?: boolean }) {
  const { t } = useTranslation();
  const activeUtilityId = useUtilityWorkspaceStore(state => state.activeUtilityId);
  const setActiveUtilityId = useUtilityWorkspaceStore(state => state.setActiveUtilityId);
  const toolListOpen = useUtilityWorkspaceStore(state => state.toolListOpen);
  const setToolListOpen = useUtilityWorkspaceStore(state => state.setToolListOpen);

  return (
    <div
      data-testid="developer-utilities-workspace"
      className="flex h-full min-h-0 flex-col bg-bg-panel-alt/40"
    >
      {/* No VISIBLE workspace-local header: the copy-output hint and the
          tool counter render at the end of the shell's tab strip via
          UtilityHeaderPills. Screen readers still need a landmark heading
          for the surface, hence the visually hidden h2. */}
      <h2 className="sr-only">{t('utilities.title')}</h2>
      <DeveloperUtilitiesWorkspaceBody
        selectedUtilityId={activeUtilityId}
        onSelectUtility={setActiveUtilityId}
        testId="developer-utilities-workspace-body"
        active={active}
        autoFocusSearch={toolListOpen}
        toolList={{ open: toolListOpen, setOpen: setToolListOpen }}
      />
    </div>
  );
}
