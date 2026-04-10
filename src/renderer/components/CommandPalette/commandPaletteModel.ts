import type { Template } from '../../data/templates';
import type { Snippet } from '../../stores/snippetsStore';
import type { FileTab, Language, LayoutPreset } from '../../types';
import {
  extensionForLanguage,
} from '../../utils/languageMeta';

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
  templates: Template[];
  snippets: Snippet[];
  updateStatus: UpdateStatus;
  createTab: (tab: Omit<FileTab, 'isDirty'>) => void;
  createDefaultTab: (language: Language) => FileTab;
  setLayoutPreset: (preset: LayoutPreset) => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenSnippets: () => void;
  checkForUpdates: () => Promise<void>;
  restartToApply: () => Promise<boolean>;
}

function normalizeKeywords(values: Array<string | undefined>) {
  return values.map((value) => value?.toLowerCase() ?? '');
}

function buildTemplateCommand(
  template: Template,
  createTab: (tab: Omit<FileTab, 'isDirty'>) => void,
  createDefaultTab: (language: Language) => FileTab,
  onClose: () => void
): CommandEntry {
  return {
    id: `tpl-${template.id}`,
    category: 'template',
    label: template.label,
    description: template.description,
    language: template.language,
    keywords: normalizeKeywords([template.label, template.language, template.description]),
    action: () => {
      const tab = createDefaultTab(template.language);
      createTab({
        ...tab,
        content: template.code,
        name: `${template.label}.${extensionForLanguage(template.language)}`,
      });
      onClose();
    },
  };
}

function buildSnippetCommand(
  snippet: Snippet,
  createTab: (tab: Omit<FileTab, 'isDirty'>) => void,
  createDefaultTab: (language: Language) => FileTab,
  onClose: () => void
): CommandEntry {
  return {
    id: `sn-${snippet.id}`,
    category: 'snippet',
    label: snippet.label,
    description: snippet.description || 'Custom snippet',
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

export function buildCommandPaletteModel({
  templates,
  snippets,
  updateStatus,
  createTab,
  createDefaultTab,
  setLayoutPreset,
  onClose,
  onOpenSettings,
  onOpenSnippets,
  checkForUpdates,
  restartToApply,
}: BuildCommandPaletteModelArgs): CommandEntry[] {
  const commands = [
    ...templates.map((template) =>
      buildTemplateCommand(template, createTab, createDefaultTab, onClose)
    ),
    ...snippets.map((snippet) =>
      buildSnippetCommand(snippet, createTab, createDefaultTab, onClose)
    ),
  ];

  commands.push(
    buildActionCommand(
      'action-layout-horizontal',
      'Layout: Horizontal Split',
      'Editor on top, console below',
      ['layout', 'horizontal', 'split', 'console'],
      () => {
        setLayoutPreset('horizontal');
        onClose();
      }
    ),
    buildActionCommand(
      'action-layout-vertical',
      'Layout: Vertical Split',
      'Editor left, console right',
      ['layout', 'vertical', 'split'],
      () => {
        setLayoutPreset('vertical');
        onClose();
      }
    ),
    buildActionCommand(
      'action-layout-editor',
      'Layout: Editor Only',
      'Hide the console panel',
      ['layout', 'editor', 'only', 'hide', 'console'],
      () => {
        setLayoutPreset('editor-only');
        onClose();
      }
    ),
    buildActionCommand(
      'action-snippets',
      'Open Snippets',
      'Browse, save, edit, and reuse snippets',
      ['snippets', 'snippet', 'library', 'save snippet'],
      () => {
        onClose();
        onOpenSnippets();
      }
    ),
    buildActionCommand(
      'action-settings',
      'Open Settings',
      'Themes, fonts, and preferences',
      ['settings', 'preferences', 'theme', 'font'],
      () => {
        onClose();
        onOpenSettings();
      }
    ),
    buildActionCommand(
      'action-check-updates',
      'Check for Updates',
      'Query the configured desktop update feed',
      ['updates', 'update', 'release', 'version'],
      () => {
        void checkForUpdates();
        onClose();
      }
    ),
    buildActionCommand(
      'action-restart-update',
      'Restart to Apply Update',
      updateStatus === 'downloaded'
        ? 'Restart now to install the downloaded update'
        : 'Available once an update has been downloaded',
      ['updates', 'restart', 'apply', 'install'],
      () => {
        void restartToApply();
        onClose();
      }
    )
  );

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
