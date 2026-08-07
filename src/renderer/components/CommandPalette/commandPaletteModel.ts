/**
 * Stable public facade for the Command Palette model.
 *
 * Domain registries own command composition; consumers keep importing this
 * module so ordering and public types remain source-compatible.
 */

import { assembleCommandPaletteModel } from './commandPaletteAssembler';
import type {
  BuildCommandPaletteModelArgs,
  CommandCategory,
  CommandEntry,
} from './commandPaletteModelTypes';

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

  const matches = commands.filter(
    command =>
      command.keywords.some(keyword => keyword.includes(normalizedQuery)) ||
      command.label.toLowerCase().includes(normalizedQuery) ||
      command.description.toLowerCase().includes(normalizedQuery)
  );

  // Rank, do not just filter. Searching "HTTP" used to put the `Fetch HTTP`
  // code template above `Open HTTP workspace`, because the filter preserved
  // assembly order and templates happen to be assembled first. Someone typing
  // a noun into a command palette is looking for the thing that opens it, so
  // actions outrank templates and snippets, and a label hit outranks a hit
  // that only appears in the description. Ties keep assembly order, which is
  // what `sort` guarantees for equal keys.
  return [...matches].sort(
    (a, b) => rankCommand(a, normalizedQuery) - rankCommand(b, normalizedQuery)
  );
}

const CATEGORY_RANK: Record<CommandCategory, number> = {
  action: 0,
  snippet: 1,
  template: 2,
};

function rankCommand(command: CommandEntry, normalizedQuery: string): number {
  const labelHit = command.label.toLowerCase().includes(normalizedQuery) ? 0 : 1;
  // Category dominates; a label hit only breaks ties inside a category.
  return CATEGORY_RANK[command.category] * 2 + labelHit;
}
