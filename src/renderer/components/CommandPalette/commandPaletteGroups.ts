import { formatShortcutLabel, type ShortcutId, type ShortcutOverrideMap } from '../../data/keyboardShortcuts';
import type { CommandEntry } from './commandPaletteModelTypes';

export type CommandGroupId =
  | 'autodetected'
  | 'recent'
  | 'workspaces'
  | 'commands'
  | 'utilities'
  | 'templates'
  | 'snippets';

/** Workspaces and everyday commands first; the 31 utilities and the creation flows follow. */
const COMMAND_GROUP_ORDER: readonly CommandGroupId[] = [
  'recent',
  'workspaces',
  'commands',
  'utilities',
  'templates',
  'snippets',
];

export const COMMAND_GROUP_LABEL_KEY: Record<CommandGroupId, string> = {
  autodetected: 'commandPalette.scope.autodetected',
  recent: 'commandPalette.scope.recent',
  workspaces: 'commandPalette.scope.workspaces',
  commands: 'commandPalette.scope.actions',
  utilities: 'commandPalette.scope.utilities',
  templates: 'commandPalette.scope.templates',
  snippets: 'commandPalette.scope.snippets',
};

const WORKSPACE_COMMAND_IDS = new Set([
  'action-open-sql-workspace',
  'action-open-http-workspace',
  'action-new-notebook',
  'action-open-project',
  'action-run-project-tests',
  'action-open-project-terminal',
]);

/** Palette commands whose catalog shortcut shows in the keycap column. */
const COMMAND_SHORTCUTS: Readonly<Record<string, ShortcutId>> = {
  'action-run-active-tab': 'run-toggle',
  'action-toggle-compare-with-snapshot': 'run-toggle-compare-snapshot',
  'action-toggle-variable-inspector': 'run-toggle-variable-inspector',
  'action-focus-stdin-panel': 'editor-toggle-stdin-panel',
  'action-export-capsule': 'run-export-capsule',
  'action-copy-share-link': 'run-copy-share-link',
  'action-show-dependencies': 'view-show-dependencies',
  'action-open-file': 'file-open',
  'action-save-as': 'file-save-as',
  'action-go-to-symbol': 'nav-go-to-symbol',
  'action-project-search': 'nav-project-search',
  'action-project-replace': 'nav-project-replace',
  'action-open-http-workspace': 'workspace-toggle-http',
  'action-open-sql-workspace': 'workspace-toggle-sql',
  'action-developer-utility-utility-pipelines': 'action-open-utility-pipelines',
  'action-open-import-overlay': 'action-open-import-overlay',
  'action-export-project-bundle': 'action-export-project-bundle',
  'action-open-recipes': 'action-open-recipes',
  'action-new-notebook': 'action-new-notebook',
  'action-import-capsule': 'overlay-capsule-import',
  'action-browse-capsules': 'overlay-capsule-list',
  'action-settings': 'overlay-settings',
  'action-toggle-presenter-mode': 'view-toggle-presenter',
};

export function commandGroupFor(command: CommandEntry): Exclude<CommandGroupId, 'recent' | 'autodetected'> {
  if (command.category === 'template') return 'templates';
  if (command.category === 'snippet') return 'snippets';
  if (WORKSPACE_COMMAND_IDS.has(command.id)) return 'workspaces';
  if (command.id.startsWith('action-developer-utility-')) return 'utilities';
  return 'commands';
}

/** The live keycap label for a command, honoring the user's overrides. */
export function commandShortcutLabel(
  command: CommandEntry,
  overrides: ShortcutOverrideMap
): string | null {
  if (command.shortcut) return command.shortcut;
  const id = COMMAND_SHORTCUTS[command.id];
  return id ? (formatShortcutLabel(id, overrides) ?? null) : null;
}

export interface CommandGroup {
  id: CommandGroupId;
  commands: CommandEntry[];
}

/**
 * Buckets ranked results into the palette's groups, keeping rank order inside
 * each group. Recent leads only on the empty query, and a command listed
 * there does not repeat in its own group. With `ranked`, groups follow their
 * best match, so the first row (what Enter runs) stays the top-ranked command.
 */
export function groupCommands(
  commands: readonly CommandEntry[],
  recentIds: readonly string[] = [],
  { ranked = false }: { ranked?: boolean } = {}
): CommandGroup[] {
  const byId = new Map(commands.map(command => [command.id, command]));
  const recent = recentIds
    .map(id => byId.get(id))
    .filter((command): command is CommandEntry => command !== undefined);
  const shown = new Set(recent.map(command => command.id));
  const buckets = new Map<CommandGroupId, CommandEntry[]>([['recent', recent]]);
  for (const command of commands) {
    if (shown.has(command.id)) continue;
    const group = commandGroupFor(command);
    buckets.set(group, [...(buckets.get(group) ?? []), command]);
  }
  // Buckets fill in rank order, so their insertion order is best match first.
  const order = ranked ? [...buckets.keys()] : COMMAND_GROUP_ORDER;
  return order
    .map(id => ({ id, commands: buckets.get(id) ?? [] }))
    .filter(group => group.commands.length > 0);
}

/** Index of the first row of the group after (or before) the one holding `index`. */
export function adjacentGroupStart(
  groups: readonly CommandGroup[],
  index: number,
  direction: 1 | -1
): number {
  const starts: number[] = [];
  let offset = 0;
  for (const group of groups) {
    starts.push(offset);
    offset += group.commands.length;
  }
  if (starts.length === 0) return 0;
  const current = starts.reduce((found, start, at) => (index >= start ? at : found), 0);
  const next = (current + direction + starts.length) % starts.length;
  return starts[next] ?? 0;
}
