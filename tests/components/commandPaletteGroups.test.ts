import { describe, expect, it } from 'vitest';
import {
  adjacentGroupStart,
  commandShortcutLabel,
  groupCommands,
} from '../../src/renderer/components/CommandPalette/commandPaletteGroups';
import type { CommandEntry } from '../../src/renderer/components/CommandPalette/commandPaletteModelTypes';

const entry = (id: string, category: CommandEntry['category'] = 'action'): CommandEntry => ({
  id,
  category,
  label: id,
  description: '',
  keywords: [],
  action: () => undefined,
});

const commands = [
  entry('action-settings'),
  entry('action-open-sql-workspace'),
  entry('action-developer-utility-jwt'),
  entry('template-js', 'template'),
  entry('snippet-1', 'snippet'),
];

describe('palette groups', () => {
  it('orders workspaces, commands, utilities, templates and snippets', () => {
    expect(groupCommands(commands).map(group => group.id)).toEqual([
      'workspaces',
      'commands',
      'utilities',
      'templates',
      'snippets',
    ]);
  });

  it('leads with Recent and does not repeat a recent command in its own group', () => {
    const groups = groupCommands(commands, ['action-open-sql-workspace', 'gone']);
    expect(groups[0]).toMatchObject({ id: 'recent' });
    expect(groups[0]?.commands.map(command => command.id)).toEqual(['action-open-sql-workspace']);
    expect(groups.find(group => group.id === 'workspaces')).toBeUndefined();
  });

  it('jumps to the next and previous group start, wrapping around', () => {
    const groups = groupCommands(commands);
    expect(adjacentGroupStart(groups, 0, 1)).toBe(1);
    expect(adjacentGroupStart(groups, 4, 1)).toBe(0);
    expect(adjacentGroupStart(groups, 0, -1)).toBe(4);
  });

  it('resolves catalog shortcuts by command id and keeps explicit ones', () => {
    expect(commandShortcutLabel(entry('action-open-sql-workspace'), {})).toMatch(/S$/);
    expect(commandShortcutLabel({ ...entry('action-x'), shortcut: '⌘⇧V' }, {})).toBe('⌘⇧V');
    expect(commandShortcutLabel(entry('action-x'), {})).toBeNull();
  });
});
