/** Settings rail metadata. Search vocabulary lives in settingsSearchModel. */

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
}

export const RAIL_ITEMS: readonly RailItem[] = [
  {
    id: 'general',
    group: 'workspace',
    labelKey: 'settings.tabs.general',
    icon: SettingsIcon,
    kbdToken: '1',
  },
  {
    id: 'appearance',
    group: 'workspace',
    labelKey: 'settings.tabs.appearance',
    icon: Palette,
    kbdToken: '2',
  },
  {
    id: 'editor',
    group: 'workspace',
    labelKey: 'settings.tabs.editor',
    icon: FileCode2,
    kbdToken: '3',
  },
  // Languages keeps Cmd+8 so the existing Environment through Recovery
  // shortcuts remain stable after this tab was inserted.
  {
    id: 'languages',
    group: 'workspace',
    labelKey: 'settings.tabs.languages',
    icon: Languages,
    kbdToken: '8',
  },
  {
    id: 'environment',
    group: 'workspace',
    labelKey: 'settings.tabs.environment',
    icon: Terminal,
    kbdToken: '4',
  },
  {
    id: 'privacy',
    group: 'workspace',
    labelKey: 'settings.tabs.privacy',
    icon: ShieldCheck,
    kbdToken: '9',
  },
  {
    id: 'account',
    group: 'workspace',
    labelKey: 'settings.tabs.account',
    icon: Key,
    kbdToken: '5',
  },
  {
    id: 'shortcuts',
    group: 'advanced',
    labelKey: 'settings.tabs.shortcuts',
    icon: Keyboard,
    kbdToken: '6',
  },
  {
    id: 'plugins',
    group: 'advanced',
    labelKey: 'settings.tabs.plugins',
    icon: Package,
    kbdToken: '7',
  },
  {
    id: 'recovery',
    group: 'advanced',
    labelKey: 'settings.tabs.recovery',
    icon: Wrench,
    kbdToken: '0',
  },
];
