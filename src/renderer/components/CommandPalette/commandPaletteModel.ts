import type { TFunction } from 'i18next';
import {
  DEVELOPER_UTILITIES,
  type DeveloperUtilityId,
} from '../../data/developerUtilities';
import {
  resolveTemplateFileStem,
  resolveTemplateDescription,
  resolveTemplateLabel,
  type Template,
} from '../../data/templates';
import type { Snippet } from '../../stores/snippetsStore';
import type { FileTab, Language, LayoutPreset } from '../../types';
import { extensionForLanguage } from '../../utils/languageMeta';

export type CommandCategory = 'template' | 'snippet' | 'action';

export interface CommandEntry {
  id: string;
  category: CommandCategory;
  label: string;
  description: string;
  language?: Language;
  keywords: string[];
  action: () => void;
}

interface BuildCommandPaletteModelArgs {
  templates: readonly Template[];
  snippets: Snippet[];
  updateStatus: UpdateStatus;
  createTab: (tab: Omit<FileTab, 'isDirty'>) => void;
  createDefaultTab: (language: Language) => FileTab;
  setLayoutPreset: (preset: LayoutPreset) => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenWhatsNew: () => void;
  onStartGuidedTour: () => void;
  onOpenSnippets: () => void;
  onOpenProjectSearch?: () => void;
  onOpenGoToSymbol?: () => void;
  onOpenDeveloperUtility?: (id: DeveloperUtilityId) => void;
  onOpenKeyboardShortcuts?: () => void;
  checkForUpdates: () => Promise<void>;
  restartToApply: () => Promise<boolean>;
  openFileFromDisk?: () => Promise<void>;
  saveActiveTabAs?: () => Promise<void>;
  duplicateActiveTab?: () => void;
  /**
   * Translation function. Optional so legacy callers keep working without
   * wiring i18next; when omitted, built-in action labels and descriptions
   * fall back to their English keys.
   */
  t?: TFunction;
}

function normalizeKeywords(values: Array<string | undefined>) {
  return values.map((value) => value?.toLowerCase() ?? '');
}

function buildTemplateCommand(
  template: Template,
  createTab: (tab: Omit<FileTab, 'isDirty'>) => void,
  createDefaultTab: (language: Language) => FileTab,
  onClose: () => void,
  t?: TFunction
): CommandEntry {
  const label = resolveTemplateLabel(template, t);
  const description = resolveTemplateDescription(template, t);
  const fileStem = resolveTemplateFileStem(template);

  return {
    id: `tpl-${template.id}`,
    category: 'template',
    label,
    description,
    language: template.language,
    // Keep the English `fileStem` in the keyword index so the command palette
    // stays bilingually searchable even when the active locale is not `en`
    // (see RL-018 Phase 3: discoverability aliases must survive localization).
    keywords: normalizeKeywords([label, fileStem, template.language, description]),
    action: () => {
      const tab = createDefaultTab(template.language);
      createTab({
        ...tab,
        content: template.code,
        name: `${fileStem}.${extensionForLanguage(template.language)}`,
      });
      onClose();
    },
  };
}

function buildSnippetCommand(
  snippet: Snippet,
  createTab: (tab: Omit<FileTab, 'isDirty'>) => void,
  createDefaultTab: (language: Language) => FileTab,
  onClose: () => void,
  translate: (key: string) => string
): CommandEntry {
  return {
    id: `sn-${snippet.id}`,
    category: 'snippet',
    label: snippet.label,
    description: snippet.description || translate('commandPalette.snippet.fallbackDescription'),
    language: snippet.language,
    keywords: normalizeKeywords([snippet.label, snippet.language, snippet.description]),
    action: () => {
      const tab = createDefaultTab(snippet.language);
      createTab({
        ...tab,
        content: snippet.code,
        name: `${snippet.label}.${extensionForLanguage(snippet.language)}`,
      });
      onClose();
    },
  };
}

function buildActionCommand(
  id: string,
  label: string,
  description: string,
  keywords: string[],
  action: () => void
): CommandEntry {
  return {
    id,
    category: 'action',
    label,
    description,
    keywords: normalizeKeywords(keywords),
    action,
  };
}

/**
 * Minimal fallback when no TFunction is supplied — returns the last segment
 * of the key in Title Case so legacy callers still render something readable
 * rather than a raw dot-notation string.
 */
function identityTranslate(key: string): string {
  const segment = key.split('.').pop() ?? key;
  return segment.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

export function buildCommandPaletteModel({
  templates,
  snippets,
  updateStatus,
  createTab,
  createDefaultTab,
  setLayoutPreset,
  onClose,
  onOpenSettings,
  onOpenWhatsNew,
  onStartGuidedTour,
  onOpenSnippets,
  onOpenProjectSearch,
  onOpenGoToSymbol,
  onOpenDeveloperUtility,
  onOpenKeyboardShortcuts,
  checkForUpdates,
  restartToApply,
  openFileFromDisk,
  saveActiveTabAs,
  duplicateActiveTab,
  t,
}: BuildCommandPaletteModelArgs): CommandEntry[] {
  const translate: (key: string, options?: Record<string, unknown>) => string = t
    ? (key, options) => t(key, options) as unknown as string
    : (key) => identityTranslate(key);

  const restartDescription = translate(
    updateStatus === 'downloaded'
      ? 'commandPalette.action.restartUpdate.descriptionReady'
      : 'commandPalette.action.restartUpdate.descriptionPending'
  );

  const commands: CommandEntry[] = [
    ...templates.map((template) =>
      buildTemplateCommand(template, createTab, createDefaultTab, onClose, t)
    ),
    ...snippets.map((snippet) =>
      buildSnippetCommand(snippet, createTab, createDefaultTab, onClose, translate)
    ),
    buildActionCommand(
      'action-layout-horizontal',
      translate('commandPalette.action.layout.horizontal.label'),
      translate('commandPalette.action.layout.horizontal.description'),
      ['layout', 'horizontal', 'split', 'console'],
      () => {
        setLayoutPreset('horizontal');
        onClose();
      }
    ),
    buildActionCommand(
      'action-layout-vertical',
      translate('commandPalette.action.layout.vertical.label'),
      translate('commandPalette.action.layout.vertical.description'),
      ['layout', 'vertical', 'split'],
      () => {
        setLayoutPreset('vertical');
        onClose();
      }
    ),
    buildActionCommand(
      'action-layout-editor',
      translate('commandPalette.action.layout.editorOnly.label'),
      translate('commandPalette.action.layout.editorOnly.description'),
      ['layout', 'editor', 'only', 'hide', 'console'],
      () => {
        setLayoutPreset('editor-only');
        onClose();
      }
    ),
    buildActionCommand(
      'action-snippets',
      translate('commandPalette.action.snippets.label'),
      translate('commandPalette.action.snippets.description'),
      ['snippets', 'snippet', 'library', 'save snippet'],
      () => {
        onClose();
        onOpenSnippets();
      }
    ),
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

  if (onOpenDeveloperUtility) {
    commands.push(
      ...DEVELOPER_UTILITIES.map((utility) =>
        buildActionCommand(
          `action-developer-utility-${utility.id}`,
          translate(utility.actionLabelKey),
          translate(utility.descriptionKey),
          [...utility.keywords, 'utility', 'developer', 'tool'],
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
}

export function filterCommandPaletteCommands(
  commands: CommandEntry[],
  query: string
): CommandEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return commands;
  }

  return commands.filter(
    (command) =>
      command.keywords.some((keyword) => keyword.includes(normalizedQuery)) ||
      command.label.toLowerCase().includes(normalizedQuery) ||
      command.description.toLowerCase().includes(normalizedQuery)
  );
}
