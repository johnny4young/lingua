/** Left-rail navigation for Settings. */

import { type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Kbd } from '../ui/chrome';
import { EyebrowMono } from '../ui/primitives';
import { RAIL_ITEMS, matchesFilter, type TabId } from './settingsRailModel';

interface SettingsRailProps {
  active: TabId;
  filter: string;
  onSelect: (id: TabId) => void;
}

export function SettingsRail({ active, filter, onSelect }: SettingsRailProps) {
  const { t } = useTranslation();
  const groups = ['workspace', 'advanced'] as const;
  const focusRailItem = (id: TabId) => {
    document.getElementById(`settings-rail-${id}`)?.focus();
  };
  const handleRailKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, itemId: TabId) => {
    const currentIndex = RAIL_ITEMS.findIndex(item => item.id === itemId);
    if (currentIndex < 0) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      const nextItem = RAIL_ITEMS[(currentIndex + 1) % RAIL_ITEMS.length];
      if (nextItem) focusRailItem(nextItem.id);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      const previousItem = RAIL_ITEMS[(currentIndex - 1 + RAIL_ITEMS.length) % RAIL_ITEMS.length];
      if (previousItem) focusRailItem(previousItem.id);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      const firstItem = RAIL_ITEMS[0];
      if (firstItem) focusRailItem(firstItem.id);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      const lastItem = RAIL_ITEMS[RAIL_ITEMS.length - 1];
      if (lastItem) focusRailItem(lastItem.id);
    }
  };

  return (
    <aside className="settings-rail" role="tablist" aria-label={t('settings.rail.ariaLabel')}>
      <div className="px-4 pb-3 pt-5">
        <EyebrowMono className="text-fg-subtle">{t('settings.title')}</EyebrowMono>
      </div>
      {groups.map(group => (
        <div key={group} className="pb-2">
          <p className="settings-rail-group-label">{t(`settings.rail.${group}`)}</p>
          {RAIL_ITEMS.filter(it => it.group === group).map(item => {
            const isActive = item.id === active;
            const isMatch = matchesFilter(item, filter, t);
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`settings-rail-${item.id}`}
                aria-selected={isActive}
                aria-controls={`settings-panel-${item.id}`}
                onClick={() => onSelect(item.id)}
                onKeyDown={event => handleRailKeyDown(event, item.id)}
                data-active={isActive ? 'true' : 'false'}
                data-dim={!isActive && filter && !isMatch ? 'true' : 'false'}
                className="settings-rail-row w-full"
                data-testid={`settings-tab-${item.id}`}
              >
                <span className="row-icon">
                  <Icon size={13} aria-hidden />
                </span>
                <span className="truncate text-left">{t(item.labelKey)}</span>
                <Kbd className="ml-auto">⌘{item.kbdToken}</Kbd>
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
