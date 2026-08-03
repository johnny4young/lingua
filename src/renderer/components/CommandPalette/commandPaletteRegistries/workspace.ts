import { buildActionCommand } from '../commandPaletteModelHelpers';
import type { CommandEntry, CommandPaletteRegistry } from '../commandPaletteModelTypes';

export const buildWorkspaceCommands: CommandPaletteRegistry = ({ args, translate }) => {
  const {
    onRunActiveTab,
    onOpenProject,
    onOpenProjectTests,
    onOpenProjectTerminal,
    onApplyLicense,
    onRerunLast,
    onNewProjectFromTemplate,
    onRestoreSession,
    savedSessionTabCount = 0,
    onClose,
  } = args;

  const commands: CommandEntry[] = [
    ...(onRunActiveTab
      ? [
          buildActionCommand(
            'action-run-active-tab',
            translate('commandPalette.action.runActiveTab.label'),
            translate('commandPalette.action.runActiveTab.description'),
            ['run', 'execute', 'code', 'active tab', 'ejecutar', 'codigo', 'pestana'],
            () => {
              onRunActiveTab();
              onClose();
            }
          ),
        ]
      : []),
    ...(onOpenProject
      ? [
          buildActionCommand(
            'action-open-project',
            translate('commandPalette.action.openProject.label'),
            translate('commandPalette.action.openProject.description'),
            ['open', 'project', 'folder', 'workspace', 'abrir', 'proyecto', 'carpeta'],
            () => {
              onClose();
              void onOpenProject();
            }
          ),
        ]
      : []),
    ...(onOpenProjectTests
      ? [
          buildActionCommand(
            'action-run-project-tests',
            translate('commandPalette.action.runProjectTests.label'),
            translate('commandPalette.action.runProjectTests.description'),
            ['test', 'tests', 'vitest', 'jest', 'pytest', 'go', 'cargo', 'pruebas', 'proyecto'],
            () => {
              onClose();
              onOpenProjectTests();
            }
          ),
        ]
      : []),
    ...(onOpenProjectTerminal
      ? [
          buildActionCommand(
            'action-open-project-terminal',
            translate('commandPalette.action.openProjectTerminal.label'),
            translate('commandPalette.action.openProjectTerminal.description'),
            ['terminal', 'shell', 'console', 'project', 'local', 'proyecto', 'consola'],
            () => {
              onClose();
              onOpenProjectTerminal();
            }
          ),
        ]
      : []),
    ...(onApplyLicense
      ? [
          buildActionCommand(
            'action-apply-license',
            translate('commandPalette.action.applyLicense.label'),
            translate('commandPalette.action.applyLicense.description'),
            ['apply', 'activate', 'license', 'token', 'pro', 'licencia', 'activar'],
            () => {
              onClose();
              onApplyLicense();
            }
          ),
        ]
      : []),
    // implementation — Re-run last execution. Hidden when the
    // caller does not wire `onRerunLast` so legacy callers (or
    // surfaces with no execution context) keep working.
    ...(onRerunLast
      ? [
          buildActionCommand(
            'action-rerun-last',
            translate('commandPalette.action.rerunLast.label'),
            translate('commandPalette.action.rerunLast.description'),
            ['rerun', 'replay', 'last', 'recent', 'run'],
            () => {
              onRerunLast();
              onClose();
            }
          ),
        ]
      : []),
    // implementation note — New project from curated template.
    // Hidden when the caller omits the handler so test scaffolds that
    // don't wire a Welcome surface keep working.
    ...(onNewProjectFromTemplate
      ? [
          buildActionCommand(
            'action-new-project-from-template',
            translate('commandPalette.action.newProjectFromTemplate.label'),
            translate('commandPalette.action.newProjectFromTemplate.description'),
            [
              'project',
              'template',
              'scaffold',
              'new',
              'express',
              'fastapi',
              'react',
              'cli',
              'pandas',
            ],
            () => {
              onClose();
              onNewProjectFromTemplate();
            }
          ),
        ]
      : []),
    // implementation — Restore last session. Surfaces only when the caller
    // wires the handler AND a persisted/pending snapshot with ≥1 tab exists,
    // so the command never offers to restore nothing.
    ...(onRestoreSession && savedSessionTabCount > 0
      ? [
          buildActionCommand(
            'action-restore-session',
            translate('commandPalette.action.restoreSession.label'),
            translate('commandPalette.action.restoreSession.description'),
            ['session', 'restore', 'reopen', 'tabs', 'previous', 'last'],
            () => {
              onRestoreSession();
              onClose();
            }
          ),
        ]
      : []),
  ];

  return commands;
};
