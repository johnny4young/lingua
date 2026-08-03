import { DEVELOPER_UTILITIES } from '../../../data/developerUtilities';
import { buildActionCommand } from '../commandPaletteModelHelpers';
import type { CommandEntry, CommandPaletteRegistry } from '../commandPaletteModelTypes';

export const buildUtilityCommands: CommandPaletteRegistry = ({ args, translate }) => {
  const {
    onOpenDeveloperUtility,
    onOpenKeyboardShortcuts,
    openFileFromDisk,
    saveActiveTabAs,
    duplicateActiveTab,
    onClose,
  } = args;
  const commands: CommandEntry[] = [];

  if (onOpenDeveloperUtility) {
    commands.push(
      ...DEVELOPER_UTILITIES.map(utility =>
        buildActionCommand(
          `action-developer-utility-${utility.id}`,
          translate(utility.actionLabelKey),
          translate(utility.descriptionKey),
          [...utility.keywords, ...(utility.aliases ?? []), 'utility', 'developer', 'tool'],
          () => {
            onClose();
            onOpenDeveloperUtility(utility.id);
          }
        )
      )
    );
  }

  if (onOpenKeyboardShortcuts) {
    commands.push(
      buildActionCommand(
        'action-keyboard-shortcuts',
        translate('commandPalette.action.keyboardShortcuts.label'),
        translate('commandPalette.action.keyboardShortcuts.description'),
        ['keyboard', 'shortcuts', 'keybindings', 'hotkeys', 'help'],
        () => {
          onClose();
          onOpenKeyboardShortcuts();
        }
      )
    );
  }

  if (openFileFromDisk) {
    commands.push(
      buildActionCommand(
        'action-open-file',
        translate('commandPalette.action.openFile.label'),
        translate('commandPalette.action.openFile.description'),
        ['open', 'file', 'disk', 'browse'],
        () => {
          void openFileFromDisk();
          onClose();
        }
      )
    );
  }

  if (saveActiveTabAs) {
    commands.push(
      buildActionCommand(
        'action-save-as',
        translate('commandPalette.action.saveAs.label'),
        translate('commandPalette.action.saveAs.description'),
        ['save as', 'save copy', 'export'],
        () => {
          void saveActiveTabAs();
          onClose();
        }
      )
    );
  }

  if (duplicateActiveTab) {
    commands.push(
      buildActionCommand(
        'action-duplicate-tab',
        translate('commandPalette.action.duplicateTab.label'),
        translate('commandPalette.action.duplicateTab.description'),
        ['duplicate', 'copy', 'tab', 'clone'],
        () => {
          duplicateActiveTab();
          onClose();
        }
      )
    );
  }

  return commands;
};
