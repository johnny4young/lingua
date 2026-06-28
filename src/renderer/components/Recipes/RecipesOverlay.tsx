/**
 * RL-039 Slice B — Recipes overlay (`Mod+Alt+L`).
 *
 * FASE 1 (MOV.01): chrome migrated onto the Signal-Slate `<ModalShell>`.
 * The four zones map as:
 *
 *   - HEADER : title + subtitle, with `headerClose="button"` so an `x`
 *              replaces the legacy floating close button.
 *   - BODY   : search input + language filter chips + the
 *              fuzzy-filtered scrollable list (default shell padding).
 *   - FOOTER : `<ModalFooterLegend navigate open close />` on the left
 *              and the Cancel + Open recipe action row in the trailing
 *              slot — matching the MOV.01 prototype.
 *
 * Each list row carries the title, the first-line prompt preview
 * (fold D), tag chips, and a progress badge (passed / attempted) via
 * the shared `<StatusBadge>` primitive.
 *
 * Selection opens a NEW editor tab with the recipe's `starterCode`
 * pre-filled + flips the bottom panel to the `'recipe'` sibling tab so
 * the prompt + Run + Test button surface immediately. "Open recipe"
 * does NOT fire a run, so it uses the slate accent — green is reserved
 * for the Run + Test action in the bottom panel.
 *
 * Closed on:
 *   - Escape (handled by ModalShell + the catalog key handler)
 *   - Scrim click (ModalShell)
 *   - Header `x` button
 *   - Confirm `Open` (success path)
 *   - Cancel button
 *
 * Telemetry: `recipe.opened { language }` on confirm. NO recipe id on
 * the wire (fold B in the plan — privacy posture).
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { useLessonProgressStore } from '../../stores/lessonProgressStore';
import { useRecipeStore } from '../../stores/recipeStore';
import { useUIStore } from '../../stores/uiStore';
import { RECIPE_CATALOG } from '../../data/recipes';
import { pickProse, previewPromptLine, type LessonPackV1 } from '../../../shared/lessonPack';
import { trackRecipeOpened } from '../../hooks/recipeTelemetry';
import { ModalShell } from '../ui/ModalShell';
import { ModalFooterLegend } from '../ui/ModalFooterLegend';
import { StatusBadge } from '../ui/StatusBadge';
import { cn } from '../../utils/cn';

export interface RecipesOverlayProps {
  onClose: () => void;
}

type LanguageFilter = 'all' | 'javascript';

// The catalog is JS-only today; keep the filter typed narrowly so future
// language recipe packs must expand this union and the i18n keys together.
const LANGUAGE_FILTERS: ReadonlyArray<LanguageFilter> = ['all', 'javascript'];

function scoreRecipe(
  recipe: LessonPackV1,
  search: string,
  locale: 'en' | 'es'
): number {
  if (search.length === 0) return 1;
  const haystack = [
    pickProse(recipe.title, locale).toLowerCase(),
    pickProse(recipe.prompt, locale).toLowerCase(),
    recipe.tags.join(' '),
    recipe.id,
  ].join(' ');
  const needle = search.toLowerCase().trim();
  // Exact phrase hits should sort above broad token matches so a title/id
  // search keeps the intended recipe at the top of keyboard selection.
  if (haystack.includes(needle)) return 2; // direct substring
  // token match (every needle token appears somewhere in the catalog text)
  const tokens = needle.split(/\s+/);
  if (tokens.every((token) => haystack.includes(token))) return 1;
  return 0;
}

export function RecipesOverlay({ onClose }: RecipesOverlayProps) {
  const { t, i18n } = useTranslation();
  const locale: 'en' | 'es' = i18n.language?.startsWith('es') ? 'es' : 'en';
  const titleId = useId();
  const listboxId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState<LanguageFilter>('all');
  const [activeIdx, setActiveIdx] = useState(0);

  const progressEntries = useLessonProgressStore((s) => s.entries);
  const filtered = useMemo(() => {
    return RECIPE_CATALOG.map((recipe) => ({
      recipe,
      score: scoreRecipe(recipe, search, locale),
    }))
      .filter((entry) => entry.score > 0)
      .filter(({ recipe }) =>
        language === 'all' ? true : recipe.language === language
      )
      .sort((a, b) => b.score - a.score)
      .map(({ recipe }) => recipe);
  }, [search, language, locale]);
  // Search/filter changes can shrink the list after `activeIdx` points past
  // the end; Enter and the footer CTA must always resolve to an existing row.
  const effectiveActiveIdx =
    filtered.length === 0 ? 0 : Math.min(activeIdx, filtered.length - 1);

  const recordOpened = useLessonProgressStore((s) => s.recordOpened);
  const bindRecipeToTab = useRecipeStore((s) => s.bindRecipeToTab);
  const openBottomPanel = useUIStore((s) => s.openBottomPanel);
  const addTab = useEditorStore((s) => s.addTab);

  const handleOpen = useCallback(
    (recipe: LessonPackV1) => {
      const tabId = crypto.randomUUID();
      addTab({
        id: tabId,
        name: `${recipe.id}.js`,
        language: 'javascript',
        content: recipe.starterCode,
        recipeBindingId: recipe.id,
      });
      // `addTab` can refuse a write when tab limits or store guards fail.
      // Only bind progress/telemetry/close once the new tab actually exists.
      const opened = useEditorStore
        .getState()
        .tabs.some((tab) => tab.id === tabId);
      if (!opened) return;
      bindRecipeToTab(tabId, recipe.id);
      recordOpened(recipe.id);
      trackRecipeOpened({ language: recipe.language });
      openBottomPanel('recipe');
      closeRef.current();
    },
    [addTab, bindRecipeToTab, openBottomPanel, recordOpened]
  );

  // Arrow / Enter navigation. Escape is owned by ModalShell, so it is
  // intentionally not re-handled here (double-close is harmless, but we
  // keep the single owner to avoid competing preventDefault calls).
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        // Wrap navigation keeps the modal keyboard-only without requiring
        // focus to move into the scrollable listbox.
        setActiveIdx((idx) => (filtered.length === 0 ? 0 : (idx + 1) % filtered.length));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIdx((idx) =>
          filtered.length === 0 ? 0 : (idx - 1 + filtered.length) % filtered.length
        );
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const recipe = filtered[effectiveActiveIdx];
        if (recipe) handleOpen(recipe);
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [filtered, effectiveActiveIdx, handleOpen]);

  return (
    // `display: contents` keeps this test/identity wrapper out of the
    // layout box tree so the ModalShell scrim it wraps still owns the
    // full-viewport overlay. Playwright treats a `display: contents`
    // node as visible when it has a visible child, so the existing
    // `recipes-overlay` test id assertion keeps passing.
    <div data-testid="recipes-overlay" style={{ display: 'contents' }}>
      <ModalShell
        onClose={() => closeRef.current()}
        size="max-w-[720px]"
        labelledById={titleId}
        headerClose="button"
        closeLabel={t('recipes.overlay.close')}
        header={
          <div>
            <h2
              id={titleId}
              className="font-display text-body-lg font-semibold tracking-[-0.01em] text-fg-base"
            >
              {t('recipes.overlay.title')}
            </h2>
            <p className="mt-0.5 text-body-sm text-fg-subtle">
              {t('recipes.overlay.description')}
            </p>
          </div>
        }
        footerLegend={<ModalFooterLegend navigate select={false} open close />}
        trailing={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => closeRef.current()}
              data-testid="recipes-cancel"
              className="inline-flex h-7 items-center rounded-md border border-border-subtle bg-transparent px-3 text-body-sm text-fg-muted hover:bg-bg-inset hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              {t('recipes.action.cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                const recipe = filtered[effectiveActiveIdx];
                if (recipe) handleOpen(recipe);
              }}
              disabled={filtered.length === 0}
              data-testid="recipes-open"
              className="inline-flex h-7 items-center rounded-md border border-accent bg-accent px-3 text-body-sm font-medium text-fg-on-accent hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('recipes.action.open')}
            </button>
          </div>
        }
      >
        {/* TOP — search + language chips */}
        <div className="grid gap-2 px-1.5 pb-2.5 pt-1.5">
          {/*
            UX Sweep T11 — the list is a listbox driven by this search input, so
            wire the combobox pattern: the input owns aria-activedescendant so a
            screen reader announces the active recipe as Arrow keys move it.
          */}
          <input
            type="text"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActiveIdx(0);
            }}
            placeholder={t('recipes.overlay.searchPlaceholder')}
            data-testid="recipes-search-input"
            autoFocus
            spellCheck={false}
            role="combobox"
            aria-controls={filtered.length > 0 ? listboxId : undefined}
            aria-expanded={filtered.length > 0}
            aria-activedescendant={
              filtered.length > 0
                ? `${listboxId}-opt-${effectiveActiveIdx}`
                : undefined
            }
            aria-autocomplete="list"
            className="rounded-md border border-border-subtle bg-bg-inset p-2 font-mono text-body-sm text-fg-base outline-none focus:border-border-strong"
          />
          <div
            role="radiogroup"
            aria-label={t('recipes.filter.label')}
            data-testid="recipes-filter-group"
            className="flex flex-wrap gap-2"
          >
            {LANGUAGE_FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={language === value}
                onClick={() => setLanguage(value)}
                data-testid={`recipes-filter-${value}`}
                className={cn(
                  'inline-flex h-6 items-center rounded-full border px-3 font-mono text-eyebrow font-medium uppercase tracking-[0.08em]',
                  language === value
                    ? 'border-accent/40 bg-accent/10 text-accent-fg'
                    : 'border-border-subtle bg-bg-inset text-fg-muted hover:text-fg-base'
                )}
              >
                {t(`recipes.filter.${value}`)}
              </button>
            ))}
          </div>
        </div>

        {/* MIDDLE — list */}
        <div data-testid="recipes-list" className="px-1.5 pb-1.5">
          {filtered.length === 0 ? (
            <div
              data-testid="recipes-empty"
              className="grid place-items-center px-6 py-8 text-center text-body-sm text-fg-subtle"
            >
              {t('recipes.overlay.empty')}
            </div>
          ) : (
            <ul
              role="listbox"
              id={listboxId}
              aria-label={t('recipes.overlay.title')}
              className="grid gap-1.5"
            >
              {filtered.map((recipe, idx) => {
                const entry = progressEntries[recipe.id];
                const isActive = idx === effectiveActiveIdx;
                const isPassed = entry?.status === 'passed';
                return (
                  <li
                    key={recipe.id}
                    id={`${listboxId}-opt-${idx}`}
                    role="option"
                    aria-selected={isActive}
                    data-testid="recipes-list-row"
                    data-recipe-id={recipe.id}
                    data-active={isActive}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => handleOpen(recipe)}
                    className={cn(
                      'grid cursor-pointer gap-2 rounded-lg border p-3 transition-colors',
                      isActive
                        ? 'border-accent/40 bg-accent/10'
                        : 'border-border-subtle bg-bg-inset hover:border-border'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 font-display text-body font-semibold tracking-tight text-fg-base">
                        {pickProse(recipe.title, locale)}
                      </span>
                      {isPassed ? (
                        <StatusBadge tone="success" dot>
                          {t('recipes.progress.statusPassed')}
                        </StatusBadge>
                      ) : entry !== undefined ? (
                        <StatusBadge tone="neutral">
                          {t(`recipes.progress.status${capitalize(entry.status)}`)}
                        </StatusBadge>
                      ) : null}
                    </div>
                    <span
                      className="line-clamp-2 text-body-sm text-fg-subtle"
                      data-testid="recipes-row-prompt-preview"
                    >
                      {previewPromptLine(recipe.prompt, locale, 96)}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {recipe.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center rounded-sm border border-border-subtle px-1.5 py-0.5 font-mono text-nano uppercase tracking-[0.06em] text-fg-subtle"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </ModalShell>
    </div>
  );
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}
