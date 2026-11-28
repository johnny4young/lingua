import { ChevronRight } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeveloperUtilityId } from '../../data/developerUtilities';
import {
  CATEGORY_SORTED_UTILITIES,
  UTILITY_CATEGORY,
  UTILITY_CATEGORY_LABEL_KEY,
  UTILITY_CATEGORY_ORDER,
  type UtilityCategory,
} from '../../data/utilityCategories';
import type { ClipboardPeek } from '../../hooks/useClipboardSuggestion';
import { formatNumber } from '../../i18n/formatNumber';
import '../../i18n/clipboardChainsCatalog';
import { DotLeader, TypeTag } from '../ui/answer';
import { FavoriteToggleButton, FavoritesRow } from './FavoritesRow';
import { clipboardMeta, type LauncherPreviews } from './launcherPreviews';
import { UtilityLauncherRow } from './UtilityLauncherRow';
import { CATEGORY_ICON } from './utilityIcons';


const CATEGORY_TOOLS = Object.fromEntries(
  UTILITY_CATEGORY_ORDER.map((category) => [
    category,
    CATEGORY_SORTED_UTILITIES.filter((utility) => UTILITY_CATEGORY[utility.id] === category).map((utility) => utility.id),
  ])
) as Record<UtilityCategory, DeveloperUtilityId[]>;

interface UtilityLauncherListProps {
  selectedUtilityId: DeveloperUtilityId;
  onSelect: (utilityId: DeveloperUtilityId) => void;
  onRowKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  peek: ClipboardPeek | null;
  clipboardTools: readonly DeveloperUtilityId[];
  previews: LauncherPreviews;
  expanded: ReadonlySet<UtilityCategory>;
  onToggleCategory: (category: UtilityCategory) => void;
  active: boolean;
}


/** The browse view: Your clipboard, Favorites, then All tools as category rows. */
export function UtilityLauncherList({
  selectedUtilityId,
  onSelect,
  onRowKeyDown,
  peek,
  clipboardTools,
  previews,
  expanded,
  onToggleCategory,
  active,
}: UtilityLauncherListProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  return (
    <>
      {/* Stays mounted so a newly read clipboard is announced. */}
      <div role="status">
        {peek ? (
          <div className="launcher-head" data-testid="utility-launcher-clipboard-head">
            <TypeTag>{t('utilities.launcher.clipboard')}</TypeTag>
            <span className="flex-1" />
            <TypeTag className="launcher-head-meta">{clipboardMeta(peek.kind, peek.chars, t, locale)}</TypeTag>
          </div>
        ) : null}
      </div>
      {peek ? (
        <>
          <ul data-testid="utility-launcher-clipboard" aria-label={t('utilities.launcher.clipboard')}>
            {clipboardTools.map((utilityId) => (
              <li key={utilityId}>
                <UtilityLauncherRow
                  utilityId={utilityId}
                  selected={utilityId === selectedUtilityId}
                  testId={`utility-clipboard-${utilityId}`}
                  onSelect={onSelect}
                  onKeyDown={onRowKeyDown}
                  preview={previews[utilityId]}
                />
              </li>
            ))}
          </ul>
          <div aria-hidden className="launcher-rule" />
        </>
      ) : null}
      <FavoritesRow
        selectedUtilityId={selectedUtilityId}
        onSelect={onSelect}
        onRowKeyDown={onRowKeyDown}
        live={active}
      />
      <div className="launcher-head">
        <TypeTag>{t('utilities.launcher.allTools')}</TypeTag>
      </div>
      {UTILITY_CATEGORY_ORDER.map((category) => {
        const Icon = CATEGORY_ICON[category];
        const open = expanded.has(category);
        const tools = CATEGORY_TOOLS[category];
        return (
          <div key={category}>
            <div className="launcher-row">
              <button
                type="button"
                className="launcher-row-main launcher-category"
                aria-expanded={open}
                data-testid={`utility-category-${category}`}
                onClick={() => onToggleCategory(category)}
                onKeyDown={onRowKeyDown}
              >
                <Icon size={14} strokeWidth={1.6} aria-hidden className="launcher-row-icon" />
                <span className="launcher-row-name">{t(UTILITY_CATEGORY_LABEL_KEY[category])}</span>
                <DotLeader className="launcher-row-leader" />
                <span className="launcher-count">{formatNumber(tools.length, locale)}</span>
                <ChevronRight size={12} aria-hidden className="launcher-category-chevron" />
              </button>
            </div>
            {open ? (
              <ul className="launcher-category-tools" aria-label={t(UTILITY_CATEGORY_LABEL_KEY[category])}>
                {tools.map((utilityId) => (
                  <li key={utilityId}>
                    <UtilityLauncherRow
                      utilityId={utilityId}
                      selected={utilityId === selectedUtilityId}
                      testId={`utility-item-${utilityId}`}
                      onSelect={onSelect}
                      onKeyDown={onRowKeyDown}
                      actions={<FavoriteToggleButton utilityId={utilityId} />}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
