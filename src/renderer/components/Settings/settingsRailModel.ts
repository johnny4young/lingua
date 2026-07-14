/** Settings rail metadata and filter matching shared with the modal shell. */

import {
  FileCode2,
  Key,
  Keyboard,
  Languages,
  Package,
  Palette,
  Settings as SettingsIcon,
  ShieldCheck,
  Terminal,
  Wrench,
} from 'lucide-react';
import type { SettingsTabId } from '../../stores/commandBus';

export type TabId = SettingsTabId;

interface RailItem {
  id: TabId;
  group: 'workspace' | 'advanced';
  labelKey: string;
  icon: typeof SettingsIcon;
  kbdToken: string;
  /** Keywords used to match against the filter bar. Free-form, multi-word. */
  keywords: readonly string[];
}

export const RAIL_ITEMS: readonly RailItem[] = [
  {
    id: 'general',
    group: 'workspace',
    labelKey: 'settings.tabs.general',
    icon: SettingsIcon,
    kbdToken: '1',
    keywords: ['about', 'version', 'updates', 'release', 'whats new', 'tour'],
  },
  {
    id: 'appearance',
    group: 'workspace',
    labelKey: 'settings.tabs.appearance',
    icon: Palette,
    kbdToken: '2',
    keywords: ['theme', 'tema', 'font', 'fuente', 'layout', 'preset', 'language', 'idioma'],
  },
  {
    id: 'editor',
    group: 'workspace',
    labelKey: 'settings.tabs.editor',
    icon: FileCode2,
    kbdToken: '3',
    keywords: ['editor', 'monaco', 'format', 'history', 'utilities', 'autosave', 'wrap', 'indent'],
  },
  // RL-095 Slice 1 (post-review refactor) — own tab for the Language
  // Support Scorecard plus the per-language preference rows that
  // used to live at the bottom of Editor.
  {
    id: 'languages',
    group: 'workspace',
    labelKey: 'settings.tabs.languages',
    icon: Languages,
    kbdToken: '8',
    keywords: [
      'language',
      'languages',
      'lenguajes',
      'scorecard',
      'matrix',
      'lsp',
      'rust',
      'go',
      'gopls',
      'rust-analyzer',
      'ruby',
      'python',
      'typescript',
      'lua',
      'runtime',
      'capability',
      'capabilities',
      'soporte',
    ],
  },
  {
    id: 'environment',
    group: 'workspace',
    labelKey: 'settings.tabs.environment',
    icon: Terminal,
    kbdToken: '4',
    keywords: ['env', 'environment', 'variable', 'variables', 'secret'],
  },
  // RL-096 Slice 1 — Privacy + Trust dashboard. Position 5 in the
  // workspace group so it sits between Environment (which is read by
  // every runner) and Account (which stores the license token). The
  // existing `'4'` slot is taken by environment; this row picks `'9'`
  // because Recovery already claimed `'0'` and Languages claimed `'8'`.
  {
    id: 'privacy',
    group: 'workspace',
    labelKey: 'settings.tabs.privacy',
    icon: ShieldCheck,
    kbdToken: '9',
    keywords: [
      'privacy',
      'privacidad',
      'trust',
      'confianza',
      'redaction',
      'redaccion',
      'network',
      'red',
      'audit',
      'auditoria',
    ],
  },
  {
    id: 'account',
    group: 'workspace',
    labelKey: 'settings.tabs.account',
    icon: Key,
    kbdToken: '5',
    keywords: ['license', 'pro', 'trial', 'privacy', 'account', 'cuenta', 'ai', 'openai', 'llm'],
  },
  {
    id: 'shortcuts',
    group: 'advanced',
    labelKey: 'settings.tabs.shortcuts',
    icon: Keyboard,
    kbdToken: '6',
    keywords: ['keyboard', 'shortcut', 'atajo', 'kbd', 'binding'],
  },
  {
    id: 'plugins',
    group: 'advanced',
    labelKey: 'settings.tabs.plugins',
    icon: Package,
    kbdToken: '7',
    keywords: ['plugin', 'extension', 'plugins'],
  },
  {
    id: 'recovery',
    group: 'advanced',
    labelKey: 'settings.tabs.recovery',
    icon: Wrench,
    kbdToken: '0',
    keywords: ['recovery', 'recuperar', 'reset', 'backup'],
  },
];

export function matchesFilter(item: RailItem, filter: string, t: (k: string) => string): boolean {
  if (!filter) return true;
  const lowered = filter.toLowerCase();
  if (item.id.includes(lowered)) return true;
  if (t(item.labelKey).toLowerCase().includes(lowered)) return true;
  return item.keywords.some(kw => kw.toLowerCase().includes(lowered));
}
