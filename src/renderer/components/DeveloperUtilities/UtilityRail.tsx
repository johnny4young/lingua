import {
  Clock,
  Code,
  Database,
  Globe,
  KeyRound,
  Palette,
  PanelLeft,
  Search,
  Star,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShortcutLabel } from '../../hooks/useShortcutLabel';
import {
  UTILITY_CATEGORY_LABEL_KEY,
  UTILITY_CATEGORY_ORDER,
  type UtilityCategory,
} from '../../data/utilityCategories';
import { Tooltip } from '../ui/chrome';
import { cn } from '../../utils/cn';

const CATEGORY_ICON: Record<UtilityCategory, LucideIcon> = {
  data: Database,
  web: Globe,
  crypto: KeyRound,
  text: Code,
  visual: Palette,
  time: Clock,
};

interface UtilityRailProps {
  /** Category of the open tool, drawn pressed. */
  activeCategory: UtilityCategory;
  pipelinesActive: boolean;
  onSearch: () => void;
  onFavorites: () => void;
  onCategory: (category: UtilityCategory) => void;
  onPipelines: () => void;
  onExpand: () => void;
}

/** The folded tool list: search, favorites, the six categories, Pipelines and expand. */
export function UtilityRail({
  activeCategory,
  pipelinesActive,
  onSearch,
  onFavorites,
  onCategory,
  onPipelines,
  onExpand,
}: UtilityRailProps) {
  const { t } = useTranslation();
  const searchCombo = useShortcutLabel('overlay-developer-utilities') ?? '';
  const pipelinesCombo = useShortcutLabel('action-open-utility-pipelines') ?? '';
  const toggleCombo = useShortcutLabel('view-toggle-sidebar') ?? '';

  return (
    <nav
      aria-label={t('utilities.rail.label')}
      data-testid="utility-rail"
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border-subtle bg-bg-panel py-2.5"
    >
      <RailButton
        icon={Search}
        label={t('utilities.rail.search', { combo: searchCombo })}
        testId="utility-rail-search"
        onClick={onSearch}
        className="border border-border-default bg-bg-inset"
      />
      <RailButton
        icon={Star}
        label={t('utilities.rail.favorites')}
        testId="utility-rail-favorites"
        onClick={onFavorites}
        iconClassName="text-warning-fg"
      />
      <span aria-hidden className="my-1.5 h-px w-6 bg-border-default" />
      {UTILITY_CATEGORY_ORDER.map(category => (
        <RailButton
          key={category}
          icon={CATEGORY_ICON[category]}
          label={t(UTILITY_CATEGORY_LABEL_KEY[category])}
          testId={`utility-rail-${category}`}
          pressed={!pipelinesActive && category === activeCategory}
          onClick={() => onCategory(category)}
        />
      ))}
      <span className="flex-1" />
      <RailButton
        icon={Workflow}
        label={t('utilities.rail.pipelines', { combo: pipelinesCombo })}
        testId="utility-rail-pipelines"
        pressed={pipelinesActive}
        onClick={onPipelines}
      />
      <RailButton
        icon={PanelLeft}
        label={t('utilities.rail.expand', { combo: toggleCombo })}
        testId="utility-rail-expand"
        onClick={onExpand}
      />
    </nav>
  );
}

function RailButton({
  icon: Icon,
  label,
  testId,
  pressed,
  onClick,
  className,
  iconClassName,
}: {
  icon: LucideIcon;
  label: string;
  testId: string;
  pressed?: boolean;
  onClick: () => void;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <Tooltip content={label} side="right">
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        data-testid={testId}
        onClick={onClick}
        className={cn(
          'icon-button size-9 rounded-md',
          pressed && 'bg-accent-tint text-accent-fg shadow-[inset_0_0_0_1px_var(--color-accent)]',
          className
        )}
      >
        <Icon size={15} strokeWidth={1.8} aria-hidden className={iconClassName} />
      </button>
    </Tooltip>
  );
}
