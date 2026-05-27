/**
 * RL-039 Slice B — Recipes overlay (`Mod+Alt+L`).
 *
 * Full-screen overlay mirroring `<CommandPalette>` + `<QuickOpen>`
 * shape:
 *
 *   - Top   : search input + language filter chips.
 *   - Middle: fuzzy-filtered scrollable list. Each row carries the
 *             title, the first-line prompt preview (fold D), tag
 *             chips, and a progress badge (passed / attempted).
 *   - Bottom: action bar (Open + Cancel + keyboard hint).
 *
 * Selection opens a NEW editor tab with the recipe's `starterCode`
 * pre-filled + flips the bottom panel to the new `'recipe'` sibling
 * tab so the prompt + Run + Test button surface immediately.
 *
 * Closed on:
 *   - Escape
 *   - Click outside the modal body
 *   - Confirm `Open` (success path)
 *   - Cancel button
 *
 * Telemetry: `recipe.opened { language }` on confirm. NO recipe id
 * on the wire (fold B in the plan — privacy posture).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Sparkles, X } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useLessonProgressStore } from '../../stores/lessonProgressStore';
import { useRecipeStore } from '../../stores/recipeStore';
import { useUIStore } from '../../stores/uiStore';
import { RECIPE_CATALOG } from '../../data/recipes';
import { pickProse, previewPromptLine, type LessonPackV1 } from '../../../shared/lessonPack';
import { trackRecipeOpened } from '../../hooks/recipeTelemetry';
import { cn } from '../../utils/cn';

export interface RecipesOverlayProps {
  onClose: () => void;
}

type LanguageFilter = 'all' | 'javascript';

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
  if (haystack.includes(needle)) return 2; // direct substring
  // token match (every needle token appears somewhere in the catalog text)
  const tokens = needle.split(/\s+/);
  if (tokens.every((token) => haystack.includes(token))) return 1;
  return 0;
}

export function RecipesOverlay({ onClose }: RecipesOverlayProps) {
  const { t, i18n } = useTranslation();
  const locale: 'en' | 'es' = i18n.language?.startsWith('es') ? 'es' : 'en';
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

  // Escape closes.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('recipes.overlay.title')}
      data-testid="recipes-overlay"
      className="fixed inset-0 z-40 flex items-start justify-center bg-bg-base/80 p-6 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) closeRef.current();
      }}
    >
      <div className="mt-12 flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-xl">
        <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
          <div>
            <h2 className="font-display text-base font-semibold tracking-[-0.01em] text-foreground">
              {t('recipes.overlay.title')}
            </h2>
            <p className="mt-0.5 text-[11px] text-muted">
              {t('recipes.overlay.description')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => closeRef.current()}
            aria-label={t('recipes.overlay.close')}
            data-testid="recipes-overlay-close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-strong/60 hover:text-foreground"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr_auto] gap-3 p-4">
          {/* TOP — search + language chips */}
          <section className="grid gap-2">
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
              className="rounded-md border border-border/60 bg-bg-elevated p-2 font-mono text-xs text-foreground outline-none focus:border-border-strong"
            />
            <div
              role="radiogroup"
              aria-label={t('recipes.filter.label')}
              data-testid="recipes-filter-group"
              className="flex flex-wrap gap-1"
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
                    'inline-flex h-6 items-center rounded-full border px-2 text-[10px] font-medium uppercase tracking-wider',
                    language === value
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-border/60 bg-surface/40 text-muted hover:text-foreground'
                  )}
                >
                  {t(`recipes.filter.${value}`)}
                </button>
              ))}
            </div>
          </section>

          {/* MIDDLE — list */}
          <section
            data-testid="recipes-list"
            className="min-h-0 overflow-y-auto rounded-md border border-border/40 bg-surface/20"
          >
            {filtered.length === 0 ? (
              <div
                data-testid="recipes-empty"
                className="grid place-items-center p-6 text-center text-xs text-muted"
              >
                {t('recipes.overlay.empty')}
              </div>
            ) : (
              <ul role="listbox" className="grid divide-y divide-border/40">
                {filtered.map((recipe, idx) => {
                  const entry = progressEntries[recipe.id];
                  const isActive = idx === effectiveActiveIdx;
                  const isPassed = entry?.status === 'passed';
                  return (
                    <li
                      key={recipe.id}
                      role="option"
                      aria-selected={isActive}
                      data-testid="recipes-list-row"
                      data-recipe-id={recipe.id}
                      data-active={isActive}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => handleOpen(recipe)}
                      className={cn(
                        'grid cursor-pointer gap-1 p-3 text-[12px] transition-colors',
                        isActive ? 'bg-emerald-500/10 text-foreground' : 'text-foreground hover:bg-surface-strong/40'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex-1 font-semibold tracking-tight">
                          {pickProse(recipe.title, locale)}
                        </span>
                        {isPassed ? (
                          <CheckCircle
                            size={12}
                            aria-label={t('recipes.progress.statusPassed')}
                            className="text-emerald-600 dark:text-emerald-400"
                          />
                        ) : entry !== undefined ? (
                          <Sparkles
                            size={12}
                            aria-label={t(`recipes.progress.status${capitalize(entry.status)}`)}
                            className="text-amber-500"
                          />
                        ) : null}
                      </div>
                      <span
                        className="line-clamp-2 text-[11px] text-muted"
                        data-testid="recipes-row-prompt-preview"
                      >
                        {previewPromptLine(recipe.prompt, locale, 96)}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {recipe.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex h-4 items-center rounded-full border border-border/60 bg-surface/40 px-1.5 text-[9px] uppercase tracking-wider text-muted"
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
          </section>

          {/* BOTTOM — action bar */}
          <footer className="flex shrink-0 items-center justify-between border-t border-border/60 pt-3 text-[11px] text-muted">
            <span aria-hidden="true">{t('recipes.overlay.keyboardHint')}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => closeRef.current()}
                data-testid="recipes-cancel"
                className="inline-flex h-7 items-center rounded border border-border/60 bg-surface/40 px-3 text-[11px] text-muted hover:text-foreground"
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
                className="inline-flex h-7 items-center rounded border border-emerald-500/40 bg-emerald-500/10 px-3 text-[11px] font-medium text-emerald-700 hover:border-emerald-500 dark:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('recipes.action.open')}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}
