import { describe, expect, it, vi } from 'vitest';
import { BUILT_IN_TEMPLATES } from '../../src/renderer/data/templates';
import type { Snippet } from '../../src/renderer/stores/snippetsStore';
import {
  buildCommandPaletteModel,
  filterCommandPaletteCommands,
} from '../../src/renderer/components/CommandPalette/commandPaletteModel';

describe('buildCommandPaletteModel', () => {
  it('includes template, snippet, and action commands with stable metadata', () => {
    const createTab = vi.fn();
    const setLayoutPreset = vi.fn();
    const onClose = vi.fn();
    const onOpenSettings = vi.fn();
    const onOpenSnippets = vi.fn();
    const checkForUpdates = vi.fn().mockResolvedValue(undefined);
    const restartToApply = vi.fn().mockResolvedValue(true);

    const snippets: Snippet[] = [
      {
        id: 'snippet-1',
        label: 'Fetch helper',
        description: 'Reusable fetch wrapper',
        language: 'typescript',
        code: 'export async function fetcher() {}',
        createdAt: 1,
      },
    ];

    const commands = buildCommandPaletteModel({
      templates: BUILT_IN_TEMPLATES.slice(0, 1),
      snippets,
      updateStatus: 'downloaded',
      createTab,
      createDefaultTab: (language) => ({
        id: `tab-${language}`,
        name: `untitled-${language}`,
        language,
        content: '',
        isDirty: false,
      }),
      setLayoutPreset,
      onClose,
      onOpenSettings,
      onOpenSnippets,
      checkForUpdates,
      restartToApply,
    });

    expect(commands.some((command) => command.category === 'template')).toBe(true);
    expect(commands.some((command) => command.category === 'snippet')).toBe(true);
    expect(commands.some((command) => command.id === 'action-settings')).toBe(true);

    const templateCommand = commands.find((command) => command.category === 'template');
    const snippetCommand = commands.find((command) => command.category === 'snippet');
    const restartCommand = commands.find(
      (command) => command.id === 'action-restart-update'
    );

    expect(templateCommand?.keywords).toContain(templateCommand?.label.toLowerCase());
    expect(snippetCommand?.keywords).toContain('reusable fetch wrapper');
    expect(restartCommand?.description).toContain('Restart now');
  });

  it('keeps matching commands when filtering by keywords, label, or description', () => {
    const commands = [
      {
        id: 'cmd-1',
        category: 'action' as const,
        label: 'Open Settings',
        description: 'Themes and preferences',
        keywords: ['settings', 'theme'],
        action: vi.fn(),
      },
      {
        id: 'cmd-2',
        category: 'snippet' as const,
        label: 'Array utils',
        description: 'Helpers for array transforms',
        keywords: ['snippet', 'helpers'],
        action: vi.fn(),
      },
    ];

    expect(filterCommandPaletteCommands(commands, 'theme')).toEqual([commands[0]]);
    expect(filterCommandPaletteCommands(commands, 'array')).toEqual([commands[1]]);
    expect(filterCommandPaletteCommands(commands, 'transforms')).toEqual([commands[1]]);
    expect(filterCommandPaletteCommands(commands, '')).toEqual(commands);
  });
});
