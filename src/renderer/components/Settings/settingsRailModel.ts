/** Settings rail metadata. Search vocabulary lives in settingsSearchModel. */

import {
  Braces,
  FileCode2,
  FlaskConical,
  Key,
  Keyboard,
  LifeBuoy,
  Package,
  Palette,
  Plug,
  Settings as SettingsIcon,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import type { SettingsTabId } from '../../stores/commandBus';

export type TabId = SettingsTabId;

interface RailItem {
  id: TabId;
  group: 'workspace' | 'advanced';
  labelKey: string;
  icon: typeof SettingsIcon;
  kbdToken?: string;
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
  {
    id: 'languages',
    group: 'workspace',
    labelKey: 'settings.tabs.languages',
    icon: Braces,
    kbdToken: '4',
  },
  {
    id: 'environment',
    group: 'workspace',
    labelKey: 'settings.tabs.environment',
    icon: Terminal,
    kbdToken: '5',
  },
  {
    id: 'privacy',
    group: 'workspace',
    labelKey: 'settings.tabs.privacy',
    icon: ShieldCheck,
    kbdToken: '6',
  },
  {
    id: 'account',
    group: 'workspace',
    labelKey: 'settings.tabs.account',
    icon: Key,
    kbdToken: '7',
  },
  {
    id: 'integrations',
    group: 'advanced',
    labelKey: 'settings.tabs.integrations',
    icon: Plug,
    kbdToken: '8',
  },
  {
    id: 'shortcuts',
    group: 'advanced',
    labelKey: 'settings.tabs.shortcuts',
    icon: Keyboard,
    kbdToken: '9',
  },
  {
    id: 'plugins',
    group: 'advanced',
    labelKey: 'settings.tabs.plugins',
    icon: Package,
  },
  {
    id: 'labs',
    group: 'advanced',
    labelKey: 'settings.tabs.labs',
    icon: FlaskConical,
  },
  {
    id: 'recovery',
    group: 'advanced',
    labelKey: 'settings.tabs.recovery',
    icon: LifeBuoy,
    kbdToken: '0',
  },
];
