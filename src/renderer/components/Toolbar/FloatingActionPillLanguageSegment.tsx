/**
 * internal / implementation — Language chip + language picker dropdown for the
 * floating action pill. Extracted verbatim from FloatingActionPill so
 * the pill body stays readable; behaviour is unchanged.
 */

import { useTranslation } from 'react-i18next';
import { BookOpenText, ChevronDown } from 'lucide-react';
import type { EditorState, Language } from '../../types';
import { languageCapabilityBadgeKey, languageBadgeTone, languageLabel } from '../../utils/languageMeta';
import { isLanguageAllowed } from '../../../shared/entitlements';
import type { LicenseTier } from '../../../shared/license';
import { LANGUAGE_PACKS } from '../../../shared/languagePacks';
import { Kbd } from '../ui/chrome';
import { MonoBadge } from '../ui/primitives';
import type { ActionPillMenu, ActionPillMenuSetter } from './useFloatingActionPill';

const LANGUAGE_LIST: Language[] = LANGUAGE_PACKS.filter(
  (pack) =>
    (pack.execution === 'run' || pack.execution === 'compile') &&
    pack.templateIds.length > 0
).map((pack) => pack.id as Language);

export function LanguageChip({
  language,
  size = 'pill',
}: {
  language: Language;
  size?: 'pill' | 'menu';
}) {
  const meta = languageBadgeTone(language);
  const dimension = size === 'menu' ? 22 : 18;
  // Most badge codes are 2–3 glyphs (JS, TS, GO, PY, SQL). A 4-glyph
  // code (e.g. HTTP) overflows the fixed square at the base 9px size,
  // so tighten the type for long codes instead of widening the box —
  // keeps every chip a uniform square. Length-driven so it covers any
  // future 4-char code, not just HTTP.
  const isLongCode = meta.code.length >= 4;
  const baseFont = size === 'menu' ? 9.5 : 9;
  return (
    <span
      className="inline-flex items-center justify-center font-mono font-bold"
      style={{
        width: dimension,
        height: dimension,
        borderRadius: size === 'menu' ? 5 : 4,
        fontSize: isLongCode ? baseFont - 1.5 : baseFont,
        letterSpacing: isLongCode ? '0' : '0.04em',
        background: meta.background,
        color: meta.foreground,
      }}
      aria-hidden
    >
      {meta.code}
    </span>
  );
}

interface LanguageSegmentProps {
  language: Language;
  openMenu: ActionPillMenu | null;
  setOpenMenu: ActionPillMenuSetter;
  effectiveTier: LicenseTier;
  isWebBuild: boolean;
  onPickLanguage: (lang: Language) => void;
  addNotebookTab: EditorState['addNotebookTab'];
}

export function FloatingActionPillLanguageSegment({
  language,
  openMenu,
  setOpenMenu,
  effectiveTier,
  isWebBuild,
  onPickLanguage,
  addNotebookTab,
}: LanguageSegmentProps) {
  const { t } = useTranslation();
  return (
    <div className="relative inline-flex items-stretch">
      <button
        type="button"
        className="action-pill-segment action-pill-lang rounded-l-lg rounded-r-none"
        aria-haspopup="menu"
        aria-expanded={openMenu === 'lang'}
        onClick={() => setOpenMenu(openMenu === 'lang' ? null : 'lang')}
        data-testid="action-pill-lang"
      >
        <LanguageChip language={language} />
        <span>{languageLabel(language)}</span>
        <ChevronDown size={10} className="text-fg-subtle" aria-hidden />
      </button>
      {openMenu === 'lang' ? (
        <div className="dropdown-rich absolute left-0 top-[calc(100%+0.4rem)] z-50 w-[280px]" role="menu">
          {LANGUAGE_LIST.map((lang) => {
            const isPro = !isLanguageAllowed(effectiveTier, lang);
            const isDesktopOnly =
              isWebBuild &&
              languageCapabilityBadgeKey(lang) === 'language.capability.desktopOnly';
            return (
              <button
                key={lang}
                type="button"
                role="menuitem"
                className="dropdown-rich-row w-full"
                onClick={() => onPickLanguage(lang)}
              >
                <LanguageChip language={lang} size="menu" />
                <span className="row-label self-center">{languageLabel(lang)}</span>
                {isPro ? (
                  <MonoBadge tone="accent">{t('actionPill.badgePro')}</MonoBadge>
                ) : isDesktopOnly ? (
                  <MonoBadge tone="accent">{t('language.capability.desktopOnly')}</MonoBadge>
                ) : (
                  <span />
                )}
              </button>
            );
          })}
          <div
            className="my-1 h-px bg-border/40"
            role="separator"
            aria-hidden="true"
          />
          <button
            type="button"
            role="menuitem"
            className="dropdown-rich-row w-full"
            data-testid="action-pill-new-notebook"
            onClick={() => {
              setOpenMenu(null);
              addNotebookTab();
            }}
          >
            <BookOpenText
              size={14}
              className="text-fg-subtle"
              aria-hidden="true"
            />
            <span className="row-label self-center">
              {t('shortcuts.item.newNotebook.label')}
            </span>
            <span />
          </button>
          <div className="dropdown-rich-footer">
            <Kbd>↑↓</Kbd>
            <span>{t('actionPill.navigate')}</span>
            <span className="flex-1" />
            <Kbd>↵</Kbd>
            <Kbd>Esc</Kbd>
          </div>
        </div>
      ) : null}
    </div>
  );
}
