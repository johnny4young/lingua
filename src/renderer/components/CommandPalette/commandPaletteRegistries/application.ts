import { buildActionCommand } from '../commandPaletteModelHelpers';
import type { CommandEntry, CommandPaletteRegistry } from '../commandPaletteModelTypes';

export const buildApplicationCommands: CommandPaletteRegistry = ({ args, translate }) => {
  const {
    updateStatus,
    onClose,
    onOpenSettings,
    onOpenWhatsNew,
    onStartGuidedTour,
    checkForUpdates,
    restartToApply,
    onOpenProjectSearch,
    onOpenProjectReplace,
    onOpenHttpWorkspace,
    onOpenSqlWorkspace,
    onOpenGoToSymbol,
  } = args;

  const restartDescription = translate(
    updateStatus === 'downloaded'
      ? 'commandPalette.action.restartUpdate.descriptionReady'
      : 'commandPalette.action.restartUpdate.descriptionPending'
  );

  const commands: CommandEntry[] = [
    buildActionCommand(
      'action-about',
      translate('commandPalette.action.about.label'),
      translate('commandPalette.action.about.description'),
      ['about', 'lingua', 'version', 'license', 'github'],
      () => {
        onClose();
        onOpenSettings();
      }
    ),
    buildActionCommand(
      'action-whats-new',
      translate('commandPalette.action.whatsNew.label'),
      translate('commandPalette.action.whatsNew.description'),
      ['whats new', 'release notes', 'changelog', 'updates'],
      () => {
        onClose();
        onOpenWhatsNew();
      }
    ),
    buildActionCommand(
      'action-guided-tour',
      translate('commandPalette.action.guidedTour.label'),
      translate('commandPalette.action.guidedTour.description'),
      ['tour', 'guided', 'onboarding', 'help'],
      () => {
        onClose();
        onStartGuidedTour();
      }
    ),
    buildActionCommand(
      'action-settings',
      translate('commandPalette.action.settings.label'),
      translate('commandPalette.action.settings.description'),
      ['settings', 'preferences', 'theme', 'font'],
      () => {
        onClose();
        onOpenSettings();
      }
    ),
    buildActionCommand(
      'action-check-updates',
      translate('commandPalette.action.checkUpdates.label'),
      translate('commandPalette.action.checkUpdates.description'),
      ['updates', 'update', 'release', 'version'],
      () => {
        onClose();
        onOpenSettings();
        void checkForUpdates();
      }
    ),
    buildActionCommand(
      'action-restart-update',
      translate('commandPalette.action.restartUpdate.label'),
      restartDescription,
      ['updates', 'restart', 'apply', 'install'],
      () => {
        void restartToApply();
        onClose();
      }
    ),
  ];

  if (onOpenProjectSearch) {
    commands.push(
      buildActionCommand(
        'action-project-search',
        translate('commandPalette.action.projectSearch.label'),
        translate('commandPalette.action.projectSearch.description'),
        ['search', 'find', 'in files', 'grep', 'text'],
        () => {
          onClose();
          onOpenProjectSearch();
        }
      )
    );
  }

  // implementation — Replace in files. Mirrors the projectSearch
  // entry so users with VSCode muscle memory find both Find AND
  // Replace via the palette without leaving Lingua.
  if (onOpenProjectReplace) {
    commands.push(
      buildActionCommand(
        'action-project-replace',
        translate('commandPalette.action.projectReplace.label'),
        translate('commandPalette.action.projectReplace.description'),
        ['replace', 'substitute', 'rename', 'find', 'project'],
        () => {
          onClose();
          onOpenProjectReplace();
        }
      )
    );
  }

  // implementation — Open the full-screen HTTP workspace tab
  // (MOV.02 moved it out of the dock). Surface aliases pick up the
  // common "fetch / api / rest / request" mental model.
  if (onOpenHttpWorkspace) {
    commands.push(
      buildActionCommand(
        'action-open-http-workspace',
        translate('commandPalette.action.openHttpWorkspace.label'),
        translate('commandPalette.action.openHttpWorkspace.description'),
        ['http', 'request', 'fetch', 'api', 'rest', 'workspace'],
        () => {
          onClose();
          onOpenHttpWorkspace();
        }
      )
    );
  }

  // implementation — Open the full-screen SQL workspace tab
  // (MOV.02 moved it out of the dock). Surface aliases pick up the
  // common "sql / query / duckdb / table" mental model. Mirror of
  // `action-open-http-workspace`.
  if (onOpenSqlWorkspace) {
    commands.push(
      buildActionCommand(
        'action-open-sql-workspace',
        translate('commandPalette.action.openSqlWorkspace.label'),
        translate('commandPalette.action.openSqlWorkspace.description'),
        ['sql', 'query', 'duckdb', 'table', 'database', 'workspace'],
        () => {
          onClose();
          onOpenSqlWorkspace();
        }
      )
    );
  }

  if (onOpenGoToSymbol) {
    commands.push(
      buildActionCommand(
        'action-go-to-symbol',
        translate('commandPalette.action.goToSymbol.label'),
        translate('commandPalette.action.goToSymbol.description'),
        ['symbol', 'outline', 'function', 'class', 'method', 'navigate'],
        () => {
          onClose();
          onOpenGoToSymbol();
        }
      )
    );
  }

  return commands;
};
