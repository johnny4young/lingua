/**
 * Search and presentation metadata for the keyboard shortcut reference UI.
 *
 * This module is imported only by the lazy Settings and Keyboard Shortcuts
 * surfaces. Global dispatch, persisted override sanitization, presets, and
 * compact shortcut hints use the structural catalog instead.
 */

import {
  KEYBOARD_SHORTCUTS,
  formatShortcutCombo,
  type ShortcutDefinition,
  type ShortcutGroupId,
  type ShortcutId,
} from './keyboardShortcuts';

interface ShortcutReferenceMetadata {
  readonly labelKey: string;
  readonly descriptionKey?: string;
  readonly keywords: readonly string[];
}

export type ShortcutReferenceDefinition = ShortcutDefinition & ShortcutReferenceMetadata;

export interface ShortcutGroupDefinition {
  readonly id: ShortcutGroupId;
  readonly labelKey: string;
}

const SHORTCUT_METADATA = {
  'run-toggle': {
    labelKey: 'shortcuts.item.runToggle.label',
    descriptionKey: 'shortcuts.item.runToggle.description',
    keywords: ['run', 'stop', 'execute'],
  },
  'run-cycle-runtime-mode': {
    labelKey: 'shortcuts.item.cycleRuntimeMode.label',
    descriptionKey: 'shortcuts.item.cycleRuntimeMode.description',
    keywords: ['runtime', 'mode', 'worker', 'node', 'browser', 'cycle'],
  },
  'run-cycle-workflow-mode': {
    labelKey: 'shortcuts.item.cycleWorkflowMode.label',
    descriptionKey: 'shortcuts.item.cycleWorkflowMode.description',
    keywords: ['workflow', 'mode', 'run', 'debug', 'scratchpad', 'cycle'],
  },
  'run-toggle-recent-runs': {
    labelKey: 'shortcuts.item.toggleRecentRuns.label',
    descriptionKey: 'shortcuts.item.toggleRecentRuns.description',
    keywords: ['history', 'recent', 'runs', 'replay', 'popover'],
  },
  'run-toggle-compare-snapshot': {
    labelKey: 'shortcuts.item.toggleCompareSnapshot.label',
    descriptionKey: 'shortcuts.item.toggleCompareSnapshot.description',
    keywords: ['compare', 'diff', 'snapshot', 'stable', 'previous'],
  },
  'run-toggle-variable-inspector': {
    labelKey: 'shortcuts.item.toggleVariableInspector.label',
    descriptionKey: 'shortcuts.item.toggleVariableInspector.description',
    keywords: ['variables', 'inspector', 'scope', 'tree'],
  },
  'editor-toggle-stdin-panel': {
    labelKey: 'shortcuts.item.toggleStdin.label',
    descriptionKey: 'shortcuts.item.toggleStdin.description',
    keywords: ['stdin', 'input', 'entrada', 'prompt'],
  },
  'run-export-capsule': {
    labelKey: 'shortcuts.item.exportCapsule.label',
    descriptionKey: 'shortcuts.item.exportCapsule.description',
    keywords: ['capsule', 'export', 'share', 'json', 'replay'],
  },
  'run-copy-share-link': {
    labelKey: 'shortcuts.item.copyShareLink.label',
    descriptionKey: 'shortcuts.item.copyShareLink.description',
    keywords: ['share', 'link', 'url', 'compartir', 'enlace', 'copy', 'copia'],
  },
  'onboarding-replay': {
    labelKey: 'shortcuts.item.replayOnboarding.label',
    descriptionKey: 'shortcuts.item.replayOnboarding.description',
    keywords: ['onboarding', 'welcome', 'inicio', 'guiado', 'replay', 'reset', 'rearm'],
  },
  'ui-reset-floating-positions': {
    labelKey: 'shortcuts.item.resetFloating.label',
    descriptionKey: 'shortcuts.item.resetFloating.description',
    keywords: ['reset', 'floating', 'pill', 'variables', 'reposition'],
  },
  'view-show-dependencies': {
    labelKey: 'shortcuts.item.showDependencies.label',
    descriptionKey: 'shortcuts.item.showDependencies.description',
    keywords: ['dependencies', 'imports', 'requires', 'modules', 'paquetes', 'dependencias'],
  },
  'view-toggle-variable-inspector-surface': {
    labelKey: 'shortcuts.item.toggleVariableInspectorSurface.label',
    descriptionKey: 'shortcuts.item.toggleVariableInspectorSurface.description',
    keywords: ['variables', 'inspector', 'surface', 'dock', 'floating', 'bottom'],
  },
  'file-save': {
    labelKey: 'shortcuts.item.save.label',
    keywords: ['save'],
  },
  'file-save-as': {
    labelKey: 'shortcuts.item.saveAs.label',
    keywords: ['save', 'as', 'saveas'],
  },
  'file-open': {
    labelKey: 'shortcuts.item.openFile.label',
    keywords: ['open', 'file'],
  },
  'file-close-tab': {
    labelKey: 'shortcuts.item.closeTab.label',
    keywords: ['close', 'tab'],
  },
  'nav-quick-open': {
    labelKey: 'shortcuts.item.quickOpen.label',
    keywords: ['quick', 'open', 'fuzzy'],
  },
  'nav-go-to-symbol': {
    labelKey: 'shortcuts.item.goToSymbol.label',
    keywords: ['symbol', 'outline'],
  },
  'nav-project-search': {
    labelKey: 'shortcuts.item.projectSearch.label',
    keywords: ['search', 'find', 'project'],
  },
  'nav-project-replace': {
    labelKey: 'shortcuts.item.projectReplace.label',
    keywords: ['replace', 'substitute', 'find', 'project', 'rename'],
  },
  'workspace-toggle-http': {
    labelKey: 'shortcuts.item.httpWorkspace.label',
    keywords: ['http', 'request', 'fetch', 'api', 'rest', 'workspace'],
  },
  'workspace-toggle-sql': {
    labelKey: 'shortcuts.item.sqlWorkspace.label',
    keywords: ['sql', 'query', 'duckdb', 'database', 'workspace'],
  },
  'action-open-utility-pipelines': {
    labelKey: 'shortcuts.item.utilityPipelines.label',
    keywords: ['pipeline', 'chain', 'compose', 'recipe', 'utility', 'workflow'],
  },
  'action-open-import-overlay': {
    labelKey: 'shortcuts.item.openImport.label',
    descriptionKey: 'shortcuts.item.openImport.description',
    keywords: ['import', 'curl', 'paste', 'drop', 'bring in'],
  },
  'action-export-project-bundle': {
    labelKey: 'shortcuts.item.exportProjectBundle.label',
    descriptionKey: 'shortcuts.item.exportProjectBundle.description',
    keywords: ['export', 'zip', 'bundle', 'project', 'download', 'archive'],
  },
  'action-open-recipes': {
    labelKey: 'shortcuts.item.openRecipes.label',
    descriptionKey: 'shortcuts.item.openRecipes.description',
    keywords: ['recipe', 'lesson', 'practice', 'tutorial', 'library'],
  },
  'action-new-notebook': {
    labelKey: 'shortcuts.item.newNotebook.label',
    descriptionKey: 'shortcuts.item.newNotebook.description',
    keywords: ['notebook', 'cell', 'jupyter', 'new', 'cuaderno'],
  },
  'overlay-capsule-import': {
    labelKey: 'shortcuts.item.importCapsule.label',
    descriptionKey: 'shortcuts.item.importCapsule.description',
    keywords: [
      'capsule',
      'import',
      'open',
      'json',
      'paste',
      'replay',
      'cargar',
      'capsula',
      'cápsula',
    ],
  },
  'overlay-capsule-list': {
    labelKey: 'shortcuts.item.browseCapsules.label',
    descriptionKey: 'shortcuts.item.browseCapsules.description',
    keywords: [
      'capsule',
      'browse',
      'list',
      'history',
      'export',
      'preview',
      'explorar',
      'capsula',
      'cápsula',
    ],
  },
  'overlay-command-palette': {
    labelKey: 'shortcuts.item.commandPalette.label',
    keywords: ['command', 'palette'],
  },
  'overlay-recent-commands': {
    labelKey: 'shortcuts.item.recentCommands.label',
    descriptionKey: 'shortcuts.item.recentCommands.description',
    keywords: ['recent', 'commands', 'history', 'repeat', 'again'],
  },
  'overlay-settings': {
    labelKey: 'shortcuts.item.settings.label',
    keywords: ['settings', 'preferences'],
  },
  'overlay-developer-utilities': {
    labelKey: 'shortcuts.item.developerUtilities.label',
    descriptionKey: 'shortcuts.item.developerUtilities.description',
    keywords: ['developer', 'utilities', 'tools', 'devtools'],
  },
  'overlay-close': {
    labelKey: 'shortcuts.item.closeOverlay.label',
    keywords: ['escape', 'close', 'dismiss'],
  },
  'view-toggle-sidebar': {
    labelKey: 'shortcuts.item.toggleSidebar.label',
    keywords: ['sidebar', 'explorer', 'toggle'],
  },
  'view-toggle-presenter': {
    labelKey: 'shortcuts.item.presenterMode.label',
    descriptionKey: 'shortcuts.item.presenterMode.description',
    keywords: ['presenter', 'focus', 'zen', 'demo', 'present'],
  },
  'view-toggle-console': {
    labelKey: 'shortcuts.item.toggleConsole.label',
    keywords: ['console', 'output', 'toggle'],
  },
  'utility-copy-output': {
    labelKey: 'shortcuts.item.utilityCopyOutput.label',
    descriptionKey: 'shortcuts.item.utilityCopyOutput.description',
    keywords: ['copy', 'output', 'clipboard', 'utility', 'utilities'],
  },
  'utility-replace-clipboard': {
    labelKey: 'shortcuts.item.utilityReplaceClipboard.label',
    descriptionKey: 'shortcuts.item.utilityReplaceClipboard.description',
    keywords: ['replace', 'clipboard', 'output', 'utility', 'utilities'],
  },
  'utility-apply-from-input': {
    labelKey: 'shortcuts.item.utilityApplyFromInput.label',
    descriptionKey: 'shortcuts.item.utilityApplyFromInput.description',
    keywords: ['apply', 'detect', 'smart', 'paste', 'utility', 'utilities'],
  },
  'debugger-toggle-breakpoint': {
    labelKey: 'shortcuts.item.debuggerToggleBreakpoint.label',
    descriptionKey: 'shortcuts.item.debuggerToggleBreakpoint.description',
    keywords: ['debugger', 'breakpoint', 'toggle'],
  },
  'debugger-continue': {
    labelKey: 'shortcuts.item.debuggerContinue.label',
    descriptionKey: 'shortcuts.item.debuggerContinue.description',
    keywords: ['debugger', 'continue', 'resume'],
  },
  'debugger-step-over': {
    labelKey: 'shortcuts.item.debuggerStepOver.label',
    descriptionKey: 'shortcuts.item.debuggerStepOver.description',
    keywords: ['debugger', 'step', 'over'],
  },
  'debugger-step-into': {
    labelKey: 'shortcuts.item.debuggerStepInto.label',
    descriptionKey: 'shortcuts.item.debuggerStepInto.description',
    keywords: ['debugger', 'step', 'into'],
  },
  'debugger-step-out': {
    labelKey: 'shortcuts.item.debuggerStepOut.label',
    descriptionKey: 'shortcuts.item.debuggerStepOut.description',
    keywords: ['debugger', 'step', 'out'],
  },
} as const satisfies Record<ShortcutId, ShortcutReferenceMetadata>;

export const SHORTCUT_GROUPS = [
  { id: 'run', labelKey: 'shortcuts.group.run' },
  { id: 'file', labelKey: 'shortcuts.group.file' },
  { id: 'navigation', labelKey: 'shortcuts.group.navigation' },
  { id: 'overlays', labelKey: 'shortcuts.group.overlays' },
  { id: 'view', labelKey: 'shortcuts.group.view' },
  { id: 'utilities', labelKey: 'shortcuts.group.utilities' },
  { id: 'debugger', labelKey: 'shortcuts.group.debugger' },
] as const satisfies readonly ShortcutGroupDefinition[];

export const KEYBOARD_SHORTCUT_REFERENCE: readonly ShortcutReferenceDefinition[] =
  KEYBOARD_SHORTCUTS.map(shortcut => ({
    ...shortcut,
    ...SHORTCUT_METADATA[shortcut.id],
  }));

/** Case-insensitive match against label keywords and token labels. */
export function filterShortcuts(
  shortcuts: readonly ShortcutReferenceDefinition[],
  query: string,
  platform: string,
  translate: (key: string) => string
): ShortcutReferenceDefinition[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [...shortcuts];

  return shortcuts.filter(shortcut => {
    const label = translate(shortcut.labelKey).toLowerCase();
    if (label.includes(trimmed)) return true;
    if (shortcut.keywords.some(keyword => keyword.includes(trimmed))) return true;
    const combos = shortcut.combos
      .map(combo => formatShortcutCombo(combo, platform))
      .join(' ')
      .toLowerCase();
    return combos.includes(trimmed);
  });
}
