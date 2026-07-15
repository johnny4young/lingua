/**
 * RL-093 / T8 — Command-action button row for the floating action pill
 * (Quick Open → Palette → Snippets → Utilities → Recipes → Browse
 * capsules) plus the Recipes progress badge. Extracted verbatim from
 * FloatingActionPill; behaviour is unchanged.
 */

import { useTranslation } from 'react-i18next';
import { Archive, Braces, Command, FileSearch, GraduationCap, Wrench } from 'lucide-react';
import { useLessonProgressStore } from '../../stores/lessonProgressStore';
import { Tooltip } from '../ui/chrome';
import { emitCommand } from '../../stores/commandBus';

interface CommandActionsProps {
  onOpenPalette?: () => void;
  onOpenQuickOpen?: () => void;
  onOpenSnippets?: () => void;
  onOpenUtilities?: () => void;
  onOpenRecipes?: () => void;
  utilitiesOpen: boolean;
  onCloseMenu: () => void;
}

export function FloatingActionPillCommandActions({
  onOpenPalette,
  onOpenQuickOpen,
  onOpenSnippets,
  onOpenUtilities,
  onOpenRecipes,
  utilitiesOpen,
  onCloseMenu,
}: CommandActionsProps) {
  const { t } = useTranslation();
  return (
    <>
      <span className="action-pill-divider" />
      <div
        className="action-pill-command-actions inline-flex items-center gap-1"
        role="toolbar"
        aria-label={t('chrome.actions.aria')}
      >
        {onOpenQuickOpen ? (
          <Tooltip content={t('chrome.quickOpen.tooltip')}>
            <button
              type="button"
              data-testid="action-pill-quick-open"
              aria-label={t('chrome.quickOpen.aria')}
              onClick={() => {
                onCloseMenu();
                onOpenQuickOpen();
              }}
              className="action-pill-icon-button"
            >
              <FileSearch size={13} aria-hidden />
            </button>
          </Tooltip>
        ) : null}
        {onOpenPalette ? (
          <Tooltip content={t('chrome.search.tooltip')}>
            <button
              type="button"
              data-testid="action-pill-search"
              aria-label={t('chrome.search.aria')}
              onClick={() => {
                onCloseMenu();
                onOpenPalette();
              }}
              className="action-pill-icon-button"
            >
              <Command size={13} aria-hidden />
            </button>
          </Tooltip>
        ) : null}
        {onOpenSnippets ? (
          <Tooltip content={t('chrome.snippets.tooltip')}>
            <button
              type="button"
              data-testid="action-pill-snippets"
              aria-label={t('chrome.snippets.aria')}
              onClick={() => {
                onCloseMenu();
                onOpenSnippets();
              }}
              className="action-pill-icon-button"
            >
              <Braces size={13} aria-hidden />
            </button>
          </Tooltip>
        ) : null}
        {onOpenUtilities ? (
          <Tooltip content={t('chrome.utilities.tooltip')}>
            <button
              type="button"
              data-testid="action-pill-utilities"
              aria-label={t('chrome.utilities.aria')}
              aria-pressed={utilitiesOpen}
              data-active={utilitiesOpen ? 'true' : 'false'}
              onClick={() => {
                onCloseMenu();
                onOpenUtilities();
              }}
              className="action-pill-icon-button"
            >
              <Wrench size={13} aria-hidden />
            </button>
          </Tooltip>
        ) : null}
        {onOpenRecipes ? (
          <RecipesActionPillButton onOpenRecipes={onOpenRecipes} onMenuClose={onCloseMenu} />
        ) : null}
        {/* RL-094 Slice 3 fold F — Browse run capsules. Emits
            the typed command App.tsx consumes (no prop threading
            through AppLayout); the overlay owns Pro-gating. */}
        <Tooltip content={t('chrome.browseCapsules.tooltip')}>
          <button
            type="button"
            data-testid="action-pill-browse-capsules"
            aria-label={t('chrome.browseCapsules.aria')}
            onClick={() => {
              onCloseMenu();
              emitCommand('capsule.openList', { surface: 'action-pill' });
            }}
            className="action-pill-icon-button"
          >
            <Archive size={13} aria-hidden />
          </button>
        </Tooltip>
      </div>
    </>
  );
}

/**
 * RL-039 Slice B fold G — Recipes pill button + progress badge.
 * Reads the lessonProgressStore directly so a passed-count change
 * does not force the parent pill to re-render (and so the badge
 * stays in sync the moment Run + Test flips a recipe to passed).
 * Mounted between Utilities and the Settings cog so the button row
 * keeps a stable left-to-right order: Quick Open → Palette →
 * Snippets → Utilities → Recipes → Settings.
 */
function RecipesActionPillButton({
  onOpenRecipes,
  onMenuClose,
}: {
  onOpenRecipes: () => void;
  onMenuClose: () => void;
}) {
  const { t } = useTranslation();
  const passedCount = useLessonProgressStore(s => s.passedCount());
  return (
    <Tooltip content={t('chrome.recipes.tooltip')}>
      <button
        type="button"
        data-testid="action-pill-recipes"
        aria-label={t('chrome.recipes.aria')}
        onClick={() => {
          onMenuClose();
          onOpenRecipes();
        }}
        className="action-pill-icon-button relative"
      >
        <GraduationCap size={13} aria-hidden />
        {passedCount > 0 ? (
          <span
            data-testid="action-pill-recipes-badge"
            data-passed-count={passedCount}
            aria-label={t('chrome.recipes.badgeAria', { count: passedCount })}
            className="absolute -right-1 -top-1 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full border border-success-border bg-success-fg px-0.5 text-nano font-bold leading-none text-fg-on-accent shadow-sm"
          >
            {passedCount > 99 ? '99+' : passedCount}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}
