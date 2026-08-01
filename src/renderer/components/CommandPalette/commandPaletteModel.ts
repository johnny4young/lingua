/**
 * Stable public facade for the Command Palette model.
 *
 * Domain registries own command composition; consumers keep importing this
 * module so ordering and public types remain source-compatible.
 */

import { assembleCommandPaletteModel } from './commandPaletteAssembler';
import type { BuildCommandPaletteModelArgs, CommandEntry } from './commandPaletteModelTypes';

export type { CommandCategory, CommandEntry } from './commandPaletteModelTypes';

export function buildCommandPaletteModel(args: BuildCommandPaletteModelArgs): CommandEntry[] {
  return assembleCommandPaletteModel(args);
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
    command =>
      command.keywords.some(keyword => keyword.includes(normalizedQuery)) ||
      command.label.toLowerCase().includes(normalizedQuery) ||
      command.description.toLowerCase().includes(normalizedQuery)
  );
}
