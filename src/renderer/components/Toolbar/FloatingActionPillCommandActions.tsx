/** Direct commands and the narrow-screen overflow share one action model. */

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  Braces,
  Command,
  FileSearch,
  GraduationCap,
  MoreHorizontal,
  Wrench,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useLessonProgressStore } from '../../stores/lessonProgressStore';
import { Tooltip } from '../ui/chrome';
import { emitCommand } from '../../stores/commandBus';
import type { ActionPillMenu, ActionPillMenuSetter } from './useFloatingActionPill';

interface CommandActionsProps {
  onOpenPalette?: () => void;
  onOpenQuickOpen?: () => void;
  onOpenSnippets?: () => void;
  onOpenUtilities?: () => void;
  onOpenRecipes?: () => void;
  onOpenSettings?: () => void;
  showBrowseCapsules: boolean;
  utilitiesOpen: boolean;
  openMenu: ActionPillMenu | null;
  setOpenMenu: ActionPillMenuSetter;
}

interface PillCommand {
  id: string;
  label: string;
  tooltip: string;
  icon: ReactNode;
  activate: () => void;
  pressed?: boolean;
}

function RecipesBadge({ testId = 'action-pill-recipes-badge' }: { testId?: string }) {
  const { t } = useTranslation();
  const passedCount = useLessonProgressStore(state => state.passedCount());
  if (passedCount <= 0) return null;
  return (
    <span
      data-testid={testId}
      data-passed-count={passedCount}
      aria-label={t('chrome.recipes.badgeAria', { count: passedCount })}
      className="absolute -right-1 -top-1 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full border border-success-border bg-success-fg px-0.5 text-nano font-bold leading-none text-fg-on-accent shadow-sm"
    >
      {passedCount > 99 ? '99+' : passedCount}
    </span>
  );
}

export function FloatingActionPillCommandActions({
  onOpenPalette,
  onOpenQuickOpen,
  onOpenSnippets,
  onOpenUtilities,
  onOpenRecipes,
  onOpenSettings,
  showBrowseCapsules,
  utilitiesOpen,
  openMenu,
  setOpenMenu,
}: CommandActionsProps) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const commands: PillCommand[] = [];
  if (onOpenQuickOpen) {
    commands.push({
      id: 'quick-open',
      label: t('chrome.quickOpen.aria'),
      tooltip: t('chrome.quickOpen.tooltip'),
      icon: <FileSearch size={16} aria-hidden />,
      activate: onOpenQuickOpen,
    });
  }
  if (onOpenPalette) {
    commands.push({
      id: 'search',
      label: t('chrome.search.aria'),
      tooltip: t('chrome.search.tooltip'),
      icon: <Command size={16} aria-hidden />,
      activate: onOpenPalette,
    });
  }
  if (onOpenSnippets) {
    commands.push({
      id: 'snippets',
      label: t('chrome.snippets.aria'),
      tooltip: t('chrome.snippets.tooltip'),
      icon: <Braces size={16} aria-hidden />,
      activate: onOpenSnippets,
    });
  }
  if (onOpenUtilities) {
    commands.push({
      id: 'utilities',
      label: t('chrome.utilities.aria'),
      tooltip: t('chrome.utilities.tooltip'),
      icon: <Wrench size={16} aria-hidden />,
      activate: onOpenUtilities,
      pressed: utilitiesOpen,
    });
  }
  if (onOpenRecipes) {
    commands.push({
      id: 'recipes',
      label: t('chrome.recipes.aria'),
      tooltip: t('chrome.recipes.tooltip'),
      icon: <GraduationCap size={16} aria-hidden />,
      activate: onOpenRecipes,
    });
  }
  if (showBrowseCapsules) {
    commands.push({
      id: 'browse-capsules',
      label: t('chrome.browseCapsules.aria'),
      tooltip: t('chrome.browseCapsules.tooltip'),
      icon: <Archive size={16} aria-hidden />,
      activate: () => emitCommand('capsule.openList', { surface: 'action-pill' }),
    });
  }
  if (onOpenSettings) {
    commands.push({
      id: 'settings',
      label: t('actionPill.settingsTooltip'),
      tooltip: t('actionPill.settingsTooltip'),
      icon: <SettingsIcon size={16} aria-hidden />,
      activate: onOpenSettings,
    });
  }
  const directCommands = commands.filter(command => command.id !== 'settings');
  const overflowOpen = openMenu === 'actions';

  useEffect(() => {
    if (overflowOpen)
      menuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus();
  }, [overflowOpen]);

  const activate = (command: PillCommand) => {
    setOpenMenu(null);
    command.activate();
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []),
    ];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpenMenu(null);
      triggerRef.current?.focus();
      return;
    } else return;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <>
      {directCommands.length > 0 ? (
        <>
          <span className="action-pill-divider action-pill-direct-actions" />
          <div
            className="action-pill-command-actions action-pill-direct-actions items-center gap-1"
            role="toolbar"
            aria-label={t('chrome.actions.aria')}
          >
            {directCommands.map(command => (
              <Tooltip key={command.id} content={command.tooltip}>
                <button
                  type="button"
                  data-testid={`action-pill-${command.id}`}
                  aria-label={command.label}
                  aria-pressed={command.pressed}
                  data-active={command.pressed ? 'true' : 'false'}
                  onClick={() => activate(command)}
                  className={`action-pill-icon-button${command.id === 'recipes' ? ' relative' : ''}`}
                >
                  {command.icon}
                  {command.id === 'recipes' ? <RecipesBadge /> : null}
                </button>
              </Tooltip>
            ))}
          </div>
        </>
      ) : null}
      {commands.length > 0 ? (
        <div className="action-pill-overflow relative">
          <button
            ref={triggerRef}
            type="button"
            data-testid="action-pill-overflow"
            aria-label={t('actionPill.moreActions')}
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            aria-controls="action-pill-overflow-menu"
            onClick={() => setOpenMenu(overflowOpen ? null : 'actions')}
            className="action-pill-icon-button"
          >
            <MoreHorizontal size={16} aria-hidden />
          </button>
          {overflowOpen ? (
            <div
              ref={menuRef}
              id="action-pill-overflow-menu"
              role="menu"
              aria-label={t('actionPill.moreActions')}
              onKeyDown={onMenuKeyDown}
              className="dropdown-rich absolute right-0 top-[calc(100%+0.4rem)] z-50 min-w-[220px] max-h-[70vh] overflow-y-auto"
            >
              {commands.map(command => (
                <button
                  key={command.id}
                  type="button"
                  role={command.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'}
                  aria-checked={command.pressed}
                  data-testid={`action-pill-overflow-${command.id}`}
                  onClick={() => activate(command)}
                  className="dropdown-rich-row flex w-full items-center gap-3 text-left"
                >
                  <span className={command.id === 'recipes' ? 'relative inline-flex' : 'inline-flex'}>
                    {command.icon}
                    {command.id === 'recipes' ? <RecipesBadge testId="action-pill-overflow-recipes-badge" /> : null}
                  </span>
                  <span>{command.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
