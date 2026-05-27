/**
 * RL-039 Slice B — `<RecipeRunPanel>`.
 *
 * Body of the bottom-panel `'recipe'` sibling tab. Only mounts when
 * the active tab has a persistent `recipeBindingId`.
 *
 * Layout:
 *   - Header  : recipe title + "Open another" + "Unbind" actions.
 *   - Prompt  : markdown subset rendered via `<RecipeMarkdown>`.
 *   - Action  : Run + Test button (disabled while running) + the
 *               last assertion summary.
 *   - Results : per-assertion rows with pass / fail / thrown / missing
 *               badges + collapsible `details` (fold C).
 */

import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { Check, Hammer, Loader2, Play, Sparkles, X } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useRecipeStore } from '../../stores/recipeStore';
import { useUIStore } from '../../stores/uiStore';
import { getRecipeById } from '../../data/recipes';
import {
  pickProse,
  type AssertionV1,
} from '../../../shared/lessonPack';
import {
  isAllPassed,
  isRecipeRunnableLanguage,
  type AssertionResultStatus,
  type AssertionRunResult,
} from '../../../shared/lessonRunner';
import { useRecipeRun } from '../../hooks/useRecipeRun';
import { cn } from '../../utils/cn';
import { RecipeMarkdown } from './recipeMarkdown';

const STATUS_TONE: Record<AssertionResultStatus, string> = {
  pass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  fail: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  thrown: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'sentinel-missing':
    'border-slate-500/40 bg-slate-500/10 text-muted',
};

export function RecipeRunPanel() {
  const { t, i18n } = useTranslation();
  const locale: 'en' | 'es' = i18n.language?.startsWith('es') ? 'es' : 'en';

  const activeTabId = useEditorStore((s) => s.activeTabId);
  const activeTab = useEditorStore((s) =>
    s.activeTabId ? s.tabs.find((entry) => entry.id === s.activeTabId) ?? null : null
  );
  const lastResults = useRecipeStore((s) => s.lastRunResults);
  const isRunning = useRecipeStore((s) =>
    activeTabId ? s.isRunning.get(activeTabId) ?? false : false
  );

  const recipeId = activeTab?.recipeBindingId ?? null;
  const recipe = useMemo(
    () => (recipeId ? getRecipeById(recipeId) ?? null : null),
    [recipeId]
  );
  const results = useMemo<ReadonlyArray<AssertionRunResult>>(
    () => (activeTabId ? lastResults.get(activeTabId) ?? [] : []),
    [activeTabId, lastResults]
  );

  const openOverlay = useRecipeStore((s) => s.openOverlay);
  const { runActiveTab, unbindActiveTab } = useRecipeRun();

  if (!activeTab || !recipe) {
    return (
      <div
        data-testid="recipe-run-panel-unbound"
        className="grid h-full place-items-center p-6 text-center text-xs text-muted"
      >
        <div className="grid gap-2">
          <p>{t('recipes.panel.unboundFallback')}</p>
          <button
            type="button"
            onClick={openOverlay}
            data-testid="recipe-run-panel-open-overlay"
            className="inline-flex h-7 items-center justify-self-center rounded border border-emerald-500/40 bg-emerald-500/10 px-3 text-[11px] font-medium text-emerald-700 hover:border-emerald-500 dark:text-emerald-300"
          >
            {t('recipes.panel.openAnother')}
          </button>
        </div>
      </div>
    );
  }

  const runnable = isRecipeRunnableLanguage(activeTab.language);

  const handleRun = async () => {
    if (!runnable) {
      useUIStore.getState().pushStatusNotice({
        tone: 'info',
        messageKey: 'recipes.notice.disabledForNonJs',
      });
      return;
    }
    await runActiveTab();
  };

  const handleUnbind = () => {
    unbindActiveTab();
  };

  const allPassed = isAllPassed(results);

  return (
    <div
      data-testid="recipe-run-panel"
      data-recipe-id={recipe.id}
      className="grid h-full grid-rows-[auto_1fr_auto] gap-0 overflow-hidden"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 px-4 py-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-sm font-semibold tracking-tight text-foreground">
            {pickProse(recipe.title, locale)}
          </h3>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">
            {recipe.tags.join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={openOverlay}
            data-testid="recipe-run-panel-open-another"
            className="inline-flex h-6 items-center rounded border border-border/60 bg-surface/40 px-2 text-[10px] uppercase tracking-wider text-muted hover:text-foreground"
          >
            {t('recipes.panel.openAnother')}
          </button>
          <button
            type="button"
            onClick={handleUnbind}
            aria-label={t('recipes.panel.unbind')}
            data-testid="recipe-run-panel-unbind"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-strong/60 hover:text-foreground"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      </header>

      <section
        className="min-h-0 overflow-y-auto px-4 py-3"
        data-testid="recipe-run-panel-prompt"
      >
        <RecipeMarkdown source={pickProse(recipe.prompt, locale)} />
      </section>

      <footer className="grid shrink-0 gap-2 border-t border-border/40 bg-surface/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRun}
            disabled={isRunning || !runnable}
            data-testid="recipe-run-panel-run"
            className={cn(
              'inline-flex h-8 items-center gap-1 rounded border px-3 text-[11px] font-medium transition-colors',
              isRunning
                ? 'border-border/40 bg-surface/40 text-muted'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:border-emerald-500 dark:text-emerald-300',
              !runnable && 'cursor-not-allowed opacity-50'
            )}
          >
            {isRunning ? (
              <>
                <Loader2 size={12} aria-hidden="true" className="animate-spin" />
                {t('recipes.panel.running')}
              </>
            ) : (
              <>
                <Play size={12} aria-hidden="true" />
                {t('recipes.panel.runAndTest')}
              </>
            )}
          </button>
          {!runnable ? (
            <span className="text-[11px] text-amber-700 dark:text-amber-300">
              {t('recipes.notice.disabledForNonJs')}
            </span>
          ) : results.length > 0 ? (
            <span
              data-testid="recipe-run-panel-summary"
              className="text-[11px] text-muted"
            >
              {allPassed ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                  <Sparkles size={11} aria-hidden="true" />
                  {t('recipes.panel.summaryPassed')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Hammer size={11} aria-hidden="true" />
                  {t('recipes.panel.summaryMixed', {
                    passed: results.filter((r) => r.status === 'pass').length,
                    total: results.length,
                  })}
                </span>
              )}
            </span>
          ) : null}
        </div>

        {results.length > 0 ? (
          <ul
            role="list"
            data-testid="recipe-run-panel-results"
            className="grid gap-1"
          >
            {results.map((result) => {
              const assertion = recipe.assertions.find(
                (a) => a.id === result.assertionId
              );
              return (
                <AssertionResultRow
                  key={result.assertionId}
                  assertion={assertion}
                  result={result}
                  locale={locale}
                />
              );
            })}
          </ul>
        ) : null}
      </footer>
    </div>
  );
}

interface AssertionResultRowProps {
  readonly assertion: AssertionV1 | undefined;
  readonly result: AssertionRunResult;
  readonly locale: 'en' | 'es';
}

function AssertionResultRow({
  assertion,
  result,
  locale,
}: AssertionResultRowProps) {
  const { t } = useTranslation();
  const tone = STATUS_TONE[result.status];
  const label =
    assertion?.name !== undefined
      ? pickProse(assertion.name, locale)
      : result.assertionId;
  const statusLabel = t(`recipes.assertion.${statusKey(result.status)}`);
  return (
    <li
      role="listitem"
      data-testid="recipe-run-panel-result-row"
      data-assertion-id={result.assertionId}
      data-status={result.status}
      className={cn(
        'grid gap-1 rounded border p-2 text-[11px]',
        tone
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">{label}</span>
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider">
          {result.status === 'pass' ? (
            <Check size={11} aria-hidden="true" />
          ) : null}
          {statusLabel}
        </span>
      </div>
      {result.details !== undefined && result.details.length > 0 ? (
        <div
          data-testid="recipe-run-panel-result-details"
          className="rounded bg-background-elevated/60 p-1.5 font-mono text-[10px] text-muted"
        >
          <span className="text-[9px] uppercase tracking-wider text-muted/70">
            {t('recipes.assertion.detailsLabel')}
          </span>
          <div className="whitespace-pre-wrap break-all">{result.details}</div>
        </div>
      ) : assertion?.hint !== undefined && result.status !== 'pass' ? (
        <p
          data-testid="recipe-run-panel-result-hint"
          className="text-[10px] text-muted"
        >
          {pickProse(assertion.hint, locale)}
        </p>
      ) : null}
    </li>
  );
}

function statusKey(status: AssertionResultStatus): string {
  switch (status) {
    case 'pass':
      return 'passed';
    case 'fail':
      return 'failed';
    case 'thrown':
      return 'thrown';
    case 'sentinel-missing':
      return 'sentinelMissing';
  }
}
