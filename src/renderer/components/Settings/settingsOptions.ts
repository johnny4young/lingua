import type { LayoutPreset } from '../../types';

export const EDITOR_THEMES: { id: string; label: string; dark: boolean }[] = [
  { id: 'runlang-dark', label: 'RunLang Dark', dark: true },
  { id: 'dracula', label: 'Dracula', dark: true },
  { id: 'one-dark-pro', label: 'One Dark Pro', dark: true },
  { id: 'monokai', label: 'Monokai', dark: true },
  { id: 'vs-dark', label: 'VS Dark', dark: true },
  { id: 'vs', label: 'VS Light', dark: false },
  { id: 'solarized-light', label: 'Solarized Light', dark: false },
  { id: 'hc-black', label: 'High Contrast Dark', dark: true },
];

export const FONT_FAMILIES: { value: string; label: string }[] = [
  { value: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", label: 'JetBrains Mono' },
  { value: "'Fira Code', monospace", label: 'Fira Code' },
  { value: "'Cascadia Code', monospace", label: 'Cascadia Code' },
  { value: 'Menlo, monospace', label: 'Menlo' },
  { value: "'Courier New', monospace", label: 'Courier New' },
  { value: 'monospace', label: 'System Monospace' },
];

export const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20, 24];

export const LAYOUT_PRESETS: { id: LayoutPreset; label: string; description: string }[] = [
  { id: 'horizontal', label: 'Horizontal Split', description: 'Editor on top, console below' },
  { id: 'vertical', label: 'Vertical Split', description: 'Editor left, console right' },
  { id: 'editor-only', label: 'Editor Only', description: 'Hide console panel' },
];
