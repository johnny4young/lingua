import { GripVertical, Star } from 'lucide-react';
import { useId, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNow } from '../../hooks/useNow';
import { useUtilityHistoryStore } from '../../stores/utilityHistoryStore';
import {
  findDeveloperUtility,
  type DeveloperUtilityId,
} from '../../data/developerUtilities';
import { TypeTag } from '../ui/answer';
import { cn } from '../../utils/cn';
import { generatorPreview, isGenerator } from './launcherPreviews';
import { UtilityLauncherRow } from './UtilityLauncherRow';

const REORDER_KEYS: Record<string, -1 | 1> = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 };

interface FavoritesRowProps {
  selectedUtilityId: DeveloperUtilityId;
  onSelect: (id: DeveloperUtilityId) => void;
  onRowKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Ticks generators' live values (Timestamp Converter shows now). */
  live?: boolean;
}

/**
 * Pinned favorites as launcher rows, hidden when nothing is pinned. Drag a
 * row by its grip, or focus the grip and press the arrow keys to reorder.
 */
export function FavoritesRow({ selectedUtilityId, onSelect, onRowKeyDown, live = true }: FavoritesRowProps) {
  const { t } = useTranslation();
  const labelId = useId();
  const favorites = useUtilityHistoryStore((state) => state.favorites);
  const reorderFavorites = useUtilityHistoryStore((state) => state.reorderFavorites);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  if (favorites.length === 0) return null;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = favorites.indexOf(active.id as DeveloperUtilityId);
    const newIndex = favorites.indexOf(over.id as DeveloperUtilityId);
    if (oldIndex < 0 || newIndex < 0) return;
    reorderFavorites(arrayMove(favorites, oldIndex, newIndex));
  };

  const moveFavorite = (id: DeveloperUtilityId, delta: -1 | 1) => {
    const oldIndex = favorites.indexOf(id);
    if (oldIndex < 0) return;
    const newIndex = Math.min(Math.max(oldIndex + delta, 0), favorites.length - 1);
    if (newIndex === oldIndex) return;
    reorderFavorites(arrayMove(favorites, oldIndex, newIndex));
  };

  return (
    <section data-testid="utilities-favorites-row" aria-labelledby={labelId}>
      <div className="launcher-head">
        <TypeTag>
          <span id={labelId}>{t('utilities.favorites.label')}</span>
        </TypeTag>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={favorites} strategy={verticalListSortingStrategy}>
          <ul aria-labelledby={labelId}>
            {favorites.map((id) => (
              <FavoriteItem
                key={id}
                id={id}
                isSelected={id === selectedUtilityId}
                onSelect={onSelect}
                onMove={moveFavorite}
                onRowKeyDown={onRowKeyDown}
                live={live}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <div aria-hidden className="launcher-rule" />
    </section>
  );
}

function FavoriteItem({
  id,
  isSelected,
  onSelect,
  onMove,
  onRowKeyDown,
  live,
}: {
  id: DeveloperUtilityId;
  isSelected: boolean;
  onSelect: (id: DeveloperUtilityId) => void;
  onMove: (id: DeveloperUtilityId, delta: -1 | 1) => void;
  onRowKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  live: boolean;
}) {
  const { t } = useTranslation();
  // Only a generator's own row ticks, and not while its panel is open.
  const now = useNow(live && isGenerator(id) && !isSelected, Date.now, 1_000);
  const definition = findDeveloperUtility(id);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      data-testid={`utility-favorite-${id}`}
      data-selected={isSelected || undefined}
    >
      <UtilityLauncherRow
        utilityId={id}
        selected={isSelected}
        testId={`utility-favorite-open-${id}`}
        onSelect={onSelect}
        onKeyDown={onRowKeyDown}
        preview={generatorPreview(id, now)}
        actions={
          <>
            <button
              type="button"
              aria-label={t('utilities.favorites.reorder', { toolName: t(definition.titleKey) })}
              className="icon-button size-6 cursor-grab rounded-md"
              {...attributes}
              {...listeners}
              onKeyUp={(event) => {
                const delta = REORDER_KEYS[event.key];
                if (!delta) return;
                event.preventDefault();
                event.stopPropagation();
                onMove(id, delta);
              }}
            >
              <GripVertical size={12} aria-hidden />
            </button>
            <FavoriteToggleButton utilityId={id} testId={`utility-favorite-unpin-${id}`} />
          </>
        }
      />
    </li>
  );
}

/** Pin or unpin a tool; the launcher rows show it on hover or focus. */
export function FavoriteToggleButton({
  utilityId,
  testId = `utility-favorite-toggle-${utilityId}`,
}: {
  utilityId: DeveloperUtilityId;
  testId?: string;
}) {
  const { t } = useTranslation();
  const isFavorite = useUtilityHistoryStore((state) => state.favorites.includes(utilityId));
  const pinFavorite = useUtilityHistoryStore((state) => state.pinFavorite);
  const unpinFavorite = useUtilityHistoryStore((state) => state.unpinFavorite);

  const definition = findDeveloperUtility(utilityId);
  const label = t(isFavorite ? 'utilities.favorites.unpin' : 'utilities.favorites.pin', {
    toolName: t(definition.titleKey),
  });

  return (
    <button
      type="button"
      data-testid={testId}
      data-pinned={isFavorite || undefined}
      onClick={(event) => {
        event.stopPropagation();
        if (isFavorite) unpinFavorite(utilityId);
        else pinFavorite(utilityId);
      }}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:text-warning-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
        isFavorite && 'text-warning-fg'
      )}
    >
      <Star size={12} aria-hidden fill={isFavorite ? 'currentColor' : 'none'} strokeWidth={isFavorite ? 0 : 2} />
    </button>
  );
}
