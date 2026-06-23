import { GripVertical, Star } from 'lucide-react';
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
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useUtilityHistoryStore } from '../../stores/utilityHistoryStore';
import {
  findDeveloperUtility,
  type DeveloperUtilityId,
} from '../../data/developerUtilities';
import { cn } from '../../utils/cn';

/**
 * RL-069 Slice 3 — pinned favorites row, rendered above the full
 * sidebar list. Hidden when the user has no favorites; otherwise the
 * row is sortable via @dnd-kit (mouse + keyboard accessible per
 * RL-088's a11y gate).
 *
 * Drag with the grip icon, release to drop. Keyboard users can focus
 * the grip and press ArrowLeft / ArrowRight to reorder; @dnd-kit still
 * owns pointer sorting and its default keyboard sensor.
 */
export function FavoritesRow({
  selectedUtilityId,
  onSelect,
}: {
  selectedUtilityId: DeveloperUtilityId;
  onSelect: (id: DeveloperUtilityId) => void;
}) {
  const { t } = useTranslation();
  const favorites = useUtilityHistoryStore((state) => state.favorites);
  const reorderFavorites = useUtilityHistoryStore(
    (state) => state.reorderFavorites
  );
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
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
    <div
      data-testid="utilities-favorites-row"
      className="border-b border-border/80 bg-background/45 px-3 py-2"
    >
      <p className="mb-1.5 text-eyebrow uppercase tracking-[0.2em] text-muted">
        {t('utilities.favorites.label')}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={favorites} strategy={horizontalListSortingStrategy}>
          <ul
            className="flex flex-wrap gap-1.5"
            aria-label={t('utilities.favorites.label')}
          >
            {favorites.map((id) => (
              <FavoriteChip
                key={id}
                id={id}
                isSelected={id === selectedUtilityId}
                onSelect={onSelect}
                onMove={moveFavorite}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function FavoriteChip({
  id,
  isSelected,
  onSelect,
  onMove,
}: {
  id: DeveloperUtilityId;
  isSelected: boolean;
  onSelect: (id: DeveloperUtilityId) => void;
  onMove: (id: DeveloperUtilityId, delta: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const definition = findDeveloperUtility(id);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid={`utility-favorite-${id}`}
      data-selected={isSelected || undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-xl border bg-background/85',
        isSelected
          ? 'border-primary/60 bg-primary-soft text-primary'
          : 'border-border/80 text-foreground hover:border-primary/40'
      )}
    >
      <button
        type="button"
        aria-label={t('utilities.favorites.reorder', { toolName: t(definition.titleKey) })}
        className="cursor-grab rounded-l-[0.85rem] px-1.5 py-1 text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        {...attributes}
        {...listeners}
        onKeyUp={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          event.stopPropagation();
          onMove(id, event.key === 'ArrowLeft' ? -1 : 1);
        }}
      >
        <GripVertical size={11} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => onSelect(id)}
        className="px-1.5 py-1 text-caption font-medium"
      >
        {t(definition.titleKey)}
      </button>
    </li>
  );
}

/** Shared pin/unpin button used by the sidebar utility rows. */
export function FavoriteToggleButton({
  utilityId,
}: {
  utilityId: DeveloperUtilityId;
}) {
  const { t } = useTranslation();
  const isFavorite = useUtilityHistoryStore((state) =>
    state.favorites.includes(utilityId)
  );
  const pinFavorite = useUtilityHistoryStore((state) => state.pinFavorite);
  const unpinFavorite = useUtilityHistoryStore((state) => state.unpinFavorite);

  const definition = findDeveloperUtility(utilityId);
  const labelKey = isFavorite
    ? 'utilities.favorites.unpin'
    : 'utilities.favorites.pin';

  return (
    <button
      type="button"
      data-testid={`utility-favorite-toggle-${utilityId}`}
      data-pinned={isFavorite || undefined}
      onClick={(event) => {
        event.stopPropagation();
        if (isFavorite) {
          unpinFavorite(utilityId);
        } else {
          pinFavorite(utilityId);
        }
      }}
      aria-label={t(labelKey, { toolName: t(definition.titleKey) })}
      title={t(labelKey, { toolName: t(definition.titleKey) })}
      className={cn(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted hover:text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
        isFavorite && 'text-warning'
      )}
    >
      <Star
        size={12}
        aria-hidden="true"
        fill={isFavorite ? 'currentColor' : 'none'}
        strokeWidth={isFavorite ? 0 : 2}
      />
    </button>
  );
}
